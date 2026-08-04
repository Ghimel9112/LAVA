'use strict';

/**
 * Genre & Language Filter
 * 
 * Two-stage filtering pipeline for autoplay candidates:
 * 
 * 1. GENRE FILTERING (Last.fm API)
 *    - Fetches top genre tags for the seed track and each candidate
 *    - Computes Jaccard similarity between tag sets
 *    - Rejects candidates below the configured overlap threshold
 *    - All Last.fm responses are cached in Redis by ISRC or "artist:title" key
 * 
 * 2. LANGUAGE FILTERING (multi-strategy)
 *    a) Metadata hints — Deezer/Tidal/Apple Music API responses sometimes
 *       include a `lang` or `country` field in pluginInfo
 *    b) Text detection — Uses the `franc` npm package as a heuristic on
 *       the track title + artist name
 *    c) Confidence gate — Only enforces language filtering when detection
 *       confidence is high enough; skips rather than falsely rejects
 * 
 * Environment:
 *   LASTFM_API_KEY — Required for genre filtering (free at last.fm/api)
 * 
 * Caching:
 *   Cache key pattern: `lastfm:tags:{isrc}` or `lastfm:tags:{artist}:{title}`
 *   TTL: 24 hours (tags rarely change)
 *   Backed by cacheStore (in-memory + JSON file persistence)
 */

const cacheStore = require('../cacheStore');
const { DEFAULTS } = require('./autoplayConfig');

// ---------------------------------------------------------------------------
// Genre & Tag Fetching (Last.fm)
// ---------------------------------------------------------------------------
// Last.fm API Helpers
// ---------------------------------------------------------------------------

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

/**
 * Make a Last.fm API request.
 * Rate-limited to ~5 req/sec (Last.fm free tier limit).
 * 
 * @param {string} method — Last.fm API method (e.g., 'track.getInfo')
 * @param {object} params — Additional query parameters
 * @param {string} apiKey — Last.fm API key
 * @returns {Promise<object|null>} Parsed JSON response, or null on failure
 */
async function lastfmRequest(method, params, apiKey) {
    if (!apiKey) return null;

    const url = new URL(LASTFM_BASE);
    url.searchParams.set('method', method);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('format', 'json');
    for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(url.toString(), { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) {
            console.warn(`[LastFM] HTTP ${res.status} for ${method} (${params.artist || ''} - ${params.track || ''})`);
            return null;
        }

        return await res.json();
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.warn(`[LastFM] Request failed for ${method}: ${err.message}`);
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Tag Fetching (with Redis caching)
// ---------------------------------------------------------------------------

/**
 * Build a Redis cache key for Last.fm tags.
 * Prefers ISRC (globally unique) over artist:title (may have collisions).
 * 
 * @param {object} trackInfo — Track's .info object
 * @returns {string} Cache key
 */
function tagCacheKey(trackInfo) {
    if (trackInfo.isrc) {
        return `lastfm:tags:${trackInfo.isrc}`;
    }
    const artist = (trackInfo.author || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const title = (trackInfo.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `lastfm:tags:${artist}:${title}`;
}

/**
 * Fetch the top genre tags for a track from Last.fm.
 * 
 * Strategy:
 *   1. Check Redis cache first
 *   2. Try `track.getInfo` (returns track-specific tags)
 *   3. If no track tags, try `artist.getTopTags` (broader genre context)
 *   4. Cache the result in Redis with 24h TTL
 * 
 * @param {object} trackInfo — Track's .info object (must have .author and .title)
 * @param {object} config — Autoplay config
 * @returns {Promise<string[]>} Array of lowercase tag names, up to topTagCount
 */
async function fetchTags(trackInfo, config) {
    const apiKey = config.lastfmApiKey;
    if (!apiKey) return [];

    const cacheKey = tagCacheKey(trackInfo);

    // ── Check cache ──────────────────────────────────────────────────────
    try {
        const cached = await cacheStore.get(cacheKey);
        if (cached) {
            return JSON.parse(cached);
        }
    } catch { /* cache miss */ }

    // ── Clean artist name (strip YouTube suffixes) ───────────────────────
    const artist = (trackInfo.author || '')
        .replace(/\s*-\s*Topic$/gi, '')
        .replace(/VEVO$/gi, '')
        .trim();

    const title = (trackInfo.title || '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .trim();

    if (!artist || !title) return [];

    let tags = [];

    // ── Strategy 1: track.getInfo ────────────────────────────────────────
    // This returns the most specific tags for this exact track.
    const trackData = await lastfmRequest('track.getInfo', { artist, track: title }, apiKey);
    if (trackData?.track?.toptags?.tag) {
        const trackTags = trackData.track.toptags.tag;
        if (Array.isArray(trackTags) && trackTags.length > 0) {
            tags = trackTags
                .slice(0, config.topTagCount)
                .map(t => (t.name || '').toLowerCase())
                .filter(t => t.length > 0);
        }
    }

    // ── Strategy 2: artist.getTopTags (fallback) ─────────────────────────
    // If the track itself has no tags, use the artist's general genre tags.
    if (tags.length === 0) {
        const artistData = await lastfmRequest('artist.getTopTags', { artist }, apiKey);
        if (artistData?.toptags?.tag) {
            const artistTags = artistData.toptags.tag;
            if (Array.isArray(artistTags) && artistTags.length > 0) {
                tags = artistTags
                    .slice(0, config.topTagCount)
                    .map(t => (t.name || '').toLowerCase())
                    .filter(t => t.length > 0);
            }
        }
    }

    // ── Cache result ─────────────────────────────────────────────────────
    try {
        await cacheStore.set(cacheKey, JSON.stringify(tags), config.lastfmCacheTTL);
    } catch { /* non-critical */ }

    return tags;
}

// ---------------------------------------------------------------------------
// Jaccard Similarity
// ---------------------------------------------------------------------------

/**
 * Compute the Jaccard similarity coefficient between two tag sets.
 * 
 * J(A, B) = |A ∩ B| / |A ∪ B|
 * 
 * Returns 0 if either set is empty (no data = no filtering).
 * Returns 1 if identical.
 * 
 * @param {string[]} tagsA — Seed track tags
 * @param {string[]} tagsB — Candidate track tags
 * @returns {number} Jaccard similarity (0 to 1)
 */
function jaccardSimilarity(tagsA, tagsB) {
    if (tagsA.length === 0 || tagsB.length === 0) return 1.0; // no data → don't filter

    const setA = new Set(tagsA);
    const setB = new Set(tagsB);

    let intersection = 0;
    for (const tag of setA) {
        if (setB.has(tag)) intersection++;
    }

    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Language Detection
// ---------------------------------------------------------------------------

/**
 * Detect the likely language of a track.
 * 
 * Strategy (in priority order):
 *   a) Metadata hints — some sources include lang/country in pluginInfo
 *   b) Text detection — run title + artist through `franc` as a heuristic
 *   c) If confidence is below threshold, return null (skip filtering)
 * 
 * @param {object} trackInfo — Track's .info object
 * @param {object} config — Autoplay config
 * @returns {Promise<{ lang: string|null, confidence: number }>}
 */
async function detectLanguage(trackInfo, config) {
    // ── Strategy A: Metadata hints ───────────────────────────────────────
    // Deezer/Tidal/Apple Music sometimes provide language or country info
    // in the pluginInfo field of the Lavalink response.
    if (trackInfo.pluginInfo) {
        const pi = trackInfo.pluginInfo;
        // Some LavaSrc versions expose the track's language or country
        if (pi.language) {
            return { lang: pi.language.toLowerCase(), confidence: 1.0 };
        }
        if (pi.countryCode) {
            // Map country to likely language (rough heuristic)
            return { lang: countryToLang(pi.countryCode), confidence: 0.8 };
        }
    }

    // ── Strategy B: franc text detection (REMOVED) ───────────────
    // Language detection on short track titles/artists is extremely inaccurate
    // and causes massive false positive rejections. We now only rely on metadata.
    
    return { lang: null, confidence: 0 };
}

/**
 * Map a country code to its most likely primary language (ISO 639-3).
 * This is a rough heuristic — many countries are multilingual.
 * 
 * @param {string} country — ISO 3166-1 alpha-2 country code
 * @returns {string} ISO 639-3 language code
 */
function countryToLang(country) {
    const map = {
        'US': 'eng', 'GB': 'eng', 'AU': 'eng', 'CA': 'eng',
        'FR': 'fra', 'DE': 'deu', 'ES': 'spa', 'MX': 'spa',
        'IT': 'ita', 'PT': 'por', 'BR': 'por',
        'JP': 'jpn', 'KR': 'kor', 'CN': 'cmn',
        'RU': 'rus', 'TR': 'tur', 'RO': 'ron',
        'IN': 'hin', 'SA': 'arb', 'EG': 'arb',
        'NL': 'nld', 'SE': 'swe', 'NO': 'nor',
        'PL': 'pol', 'TH': 'tha', 'VN': 'vie',
    };
    return map[(country || '').toUpperCase()] || 'eng';
}

// ---------------------------------------------------------------------------
// Combined Filter
// ---------------------------------------------------------------------------

/**
 * Filter candidates by genre similarity and language match with the seed track.
 * 
 * @param {object} seedTrack — The currently playing seed track
 * @param {object[]} candidates — Array of candidate Lavalink tracks
 * @param {object} config — Autoplay config (from autoplayConfig.js)
 * @returns {Promise<object[]>} Filtered candidates
 */
async function filterByGenreAndLanguage(seedTrack, candidates, config) {
    if (candidates.length === 0) return [];

    // ── Fetch seed tags ──────────────────────────────────────────────────
    const seedTags = await fetchTags(seedTrack.info, config);
    console.log(`[GenreFilter] Seed tags: [${seedTags.join(', ')}]`);

    // ── Detect seed language ─────────────────────────────────────────────
    const seedLang = await detectLanguage(seedTrack.info, config);
    if (seedLang.lang) {
        console.log(`[GenreFilter] Seed language: ${seedLang.lang} (confidence: ${seedLang.confidence.toFixed(2)})`);
    }

    // ── Filter each candidate ────────────────────────────────────────────
    const results = [];

    for (const candidate of candidates) {
        if (!candidate || !candidate.info) continue;

        // ── Genre check ──────────────────────────────────────────────────
        if (seedTags.length > 0) {
            const candidateTags = await fetchTags(candidate.info, config);

            if (candidateTags.length > 0) {
                const similarity = jaccardSimilarity(seedTags, candidateTags);
                if (similarity < config.genreOverlapThreshold) {
                    console.log(`[GenreFilter] Rejected "${candidate.info.title}" — genre sim ${similarity.toFixed(2)} < ${config.genreOverlapThreshold} (tags: [${candidateTags.join(', ')}])`);
                    continue;
                }
            }
            // If candidate has no tags, let it through (no data ≠ wrong genre)
        }

        // ── Language check ───────────────────────────────────────────────
        // Only enforce when BOTH seed and candidate have high-confidence detection.
        // This avoids false rejections from unreliable detection on short titles.
        if (seedLang.lang && seedLang.confidence >= config.languageConfidenceThreshold) {
            const candidateLang = await detectLanguage(candidate.info, config);

            if (candidateLang.lang &&
                candidateLang.confidence >= config.languageConfidenceThreshold &&
                candidateLang.lang !== seedLang.lang) {
                console.log(`[GenreFilter] Rejected "${candidate.info.title}" — language mismatch: ${candidateLang.lang} vs seed ${seedLang.lang}`);
                continue;
            }
        }
        results.push(candidate);

        // EARLY EXIT: We don't need to filter all 80+ candidates if we already have enough valid ones.
        // The first few valid tracks are usually the best recommendations anyway.
        // Limit to 5 valid candidates to save Last.fm API requests and speed up autoplay immensely.
        if (results.length >= 5) {
            break;
        }
    }

    console.log(`[GenreFilter] ${results.length}/${candidates.length} candidates passed genre/language filter.`);
    return results;
}

module.exports = {
    filterByGenreAndLanguage,
    fetchTags,
    detectLanguage,
    jaccardSimilarity,
    // Exported for testing
    countryToLang,
    tagCacheKey,
};
