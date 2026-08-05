'use strict';

/**
 * Recommendation Fetcher
 * 
 * Responsible for fetching raw recommendation candidates from music platform APIs.
 * This module does NOT filter — it only retrieves candidates. Filtering is handled
 * by the remix/live filter, genre/language filter, and history tracker.
 * 
 * Two modes:
 * 
 * PREMIUM MODE:
 *   1. Deezer recommendations: `dzrec:{trackId}` (LavaSrc-native)
 *   2. Tidal recommendations: `tdrec:{trackId}` (LavaSrc-native)
 *   3. ISRC cross-source matching for higher accuracy
 *   4. Fallback to text-based multi-source search
 * 
 * NON-PREMIUM MODE:
 *   1. Apple Music related-artist search
 *   2. YouTube Music search (`ytmsearch:`) as last resort
 *   3. No access to dzrec:/tdrec: recommendation engines
 * 
 * Provider fallback chain (for cross-source matching):
 *   Deezer → Tidal → Apple Music → SoundCloud → (YouTube Music, premium only)
 */

const { DEFAULTS } = require('./autoplayConfig');

// ---------------------------------------------------------------------------
// SoundCloud Title Parsing
// ---------------------------------------------------------------------------

/**
 * Extract the real artist and title from a SoundCloud track.
 * SoundCloud uploaders often use the format "Artist - Title" in the track name,
 * while the author field is the uploader's display name (often unrelated).
 * 
 * @param {object} trackInfo — Track's .info object
 * @returns {{ artist: string, title: string }} Cleaned artist/title
 */
function parseSoundCloudSeed(trackInfo) {
    const author = (trackInfo.author || '')
        .replace(/\s*-\s*Topic$/gi, '')
        .replace(/VEVO$/gi, '')
        .trim();

    let searchArtist = author;
    let searchTitle = trackInfo.title || '';

    if (trackInfo.sourceName === 'soundcloud' && searchTitle.includes(' - ')) {
        const dashIdx = searchTitle.indexOf(' - ');
        const parsedArtist = searchTitle.substring(0, dashIdx).trim();
        const parsedTitle = searchTitle.substring(dashIdx + 3).trim();
        if (parsedArtist.length > 1 && parsedTitle.length > 1) {
            searchArtist = parsedArtist;
            searchTitle = parsedTitle;
            console.log(`[RecommendationFetcher] SoundCloud: real artist="${searchArtist}", title="${searchTitle}" (uploader was "${author}")`);
        }
    }

    return { artist: searchArtist, title: searchTitle };
}

// ---------------------------------------------------------------------------
// Lavalink Search Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a search query through a Lavalink node.
 * Handles both v3 and v4 response formats.
 * 
 * @param {object} node — Shoukaku node
 * @param {string} query — Full query string (e.g., "dzsearch:artist - title")
 * @returns {Promise<object[]>} Array of tracks, or empty array
 */
async function resolveSearch(node, query) {
    try {
        const res = await node.rest.resolve(query);
        const loadType = res?.loadType ? res.loadType.toLowerCase() : '';

        if (loadType === 'empty' || loadType === 'error') return [];

        if (res?.data) {
            // v4 format
            if (Array.isArray(res.data)) return res.data;
            if (res.data.tracks && Array.isArray(res.data.tracks)) return res.data.tracks;
            return [];
        }

        if (res?.tracks && Array.isArray(res.tracks)) return res.tracks; // v3 format
        return [];
    } catch (err) {
        console.warn(`[RecommendationFetcher] Search failed for "${query}": ${err.message}`);
        return [];
    }
}

/**
 * Try to find a track on another platform using its ISRC.
 * ISRC-based matching is the most accurate cross-platform identification
 * because it identifies the exact same recording regardless of platform.
 * 
 * @param {object} node — Shoukaku node
 * @param {string} isrc — International Standard Recording Code
 * @returns {Promise<object|null>} Matched track, or null
 */
async function matchByIsrc(node, isrc) {
    if (!isrc) return null;

    // Try Deezer ISRC lookup first (most reliable, direct streaming)
    const dzTracks = await resolveSearch(node, `dzisrc:${isrc}`);
    if (dzTracks.length > 0) return dzTracks[0];

    // Try Tidal ISRC lookup
    const tidalTracks = await resolveSearch(node, `tidalSearch:${isrc}`);
    if (tidalTracks.length > 0) return tidalTracks[0];

    return null;
}

// ---------------------------------------------------------------------------
// Premium: Platform-Native Recommendations
// ---------------------------------------------------------------------------

/**
 * Fetch recommendations using Deezer's native recommendation engine.
 * LavaSrc supports `dzrec:{trackId}` to fetch related tracks directly
 * from Deezer's algorithm — no YouTube dependency needed.
 * 
 * @param {object} node — Shoukaku node
 * @param {object} seedTrack — The seed track
 * @returns {Promise<object[]>} Array of recommended tracks
 */
async function fetchDeezerRecommendations(node, seedTrack) {
    const info = seedTrack.info || {};

    // If the seed track is from Deezer, use its ID directly
    if (info.sourceName === 'deezer' && info.identifier) {
        console.log(`[RecommendationFetcher] Trying dzrec:${info.identifier} (direct Deezer seed)`);
        const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.deezer}${info.identifier}`);
        if (tracks.length > 0) {
            console.log(`[RecommendationFetcher] dzrec returned ${tracks.length} recommendations.`);
            return tracks;
        }
    }

    // If the seed has an ISRC, try to find it on Deezer first, then use that ID
    if (info.isrc) {
        const dzTrack = await matchByIsrc(node, info.isrc);
        if (dzTrack && dzTrack.info && dzTrack.info.sourceName === 'deezer') {
            console.log(`[RecommendationFetcher] Found Deezer match via ISRC: ${dzTrack.info.title} (${dzTrack.info.identifier})`);
            const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.deezer}${dzTrack.info.identifier}`);
            if (tracks.length > 0) {
                console.log(`[RecommendationFetcher] dzrec (via ISRC) returned ${tracks.length} recommendations.`);
                return tracks;
            }
        }
    }

    // Fallback: search Deezer by text, then use that track's ID for recommendations
    const { artist, title } = parseSoundCloudSeed(info);
    const searchResults = await resolveSearch(node, `dzsearch:${artist} - ${title}`);
    if (searchResults.length > 0) {
        const dzId = searchResults[0].info.identifier;
        console.log(`[RecommendationFetcher] Found Deezer match via search: ${searchResults[0].info.title} (${dzId})`);
        const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.deezer}${dzId}`);
        if (tracks.length > 0) {
            console.log(`[RecommendationFetcher] dzrec (via search) returned ${tracks.length} recommendations.`);
            return tracks;
        }
    }

    console.log('[RecommendationFetcher] Deezer recommendations: no results.');
    return [];
}

/**
 * Fetch recommendations using Tidal's native recommendation engine.
 * LavaSrc supports `tdrec:{trackId}` to fetch related tracks.
 * 
 * @param {object} node — Shoukaku node
 * @param {object} seedTrack — The seed track
 * @returns {Promise<object[]>} Array of recommended tracks
 */
async function fetchTidalRecommendations(node, seedTrack) {
    const info = seedTrack.info || {};

    // If the seed is from Tidal, use its ID directly
    if (info.sourceName === 'tidal' && info.identifier) {
        console.log(`[RecommendationFetcher] Trying tdrec:${info.identifier} (direct Tidal seed)`);
        const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.tidal}${info.identifier}`);
        if (tracks.length > 0) {
            console.log(`[RecommendationFetcher] tdrec returned ${tracks.length} recommendations.`);
            return tracks;
        }
    }

    // Try ISRC → Tidal lookup → recommendations
    if (info.isrc) {
        const tidalTracks = await resolveSearch(node, `tidalSearch:${info.isrc}`);
        if (tidalTracks.length > 0 && tidalTracks[0].info.sourceName === 'tidal') {
            const tidalId = tidalTracks[0].info.identifier;
            console.log(`[RecommendationFetcher] Found Tidal match via ISRC: ${tidalTracks[0].info.title} (${tidalId})`);
            const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.tidal}${tidalId}`);
            if (tracks.length > 0) {
                console.log(`[RecommendationFetcher] tdrec (via ISRC) returned ${tracks.length} recommendations.`);
                return tracks;
            }
        }
    }

    // Fallback: search Tidal by text, then use that track's ID
    const { artist, title } = parseSoundCloudSeed(info);
    const searchResults = await resolveSearch(node, `tidalSearch:${artist} - ${title}`);
    if (searchResults.length > 0) {
        const tidalId = searchResults[0].info.identifier;
        console.log(`[RecommendationFetcher] Found Tidal match via search: ${searchResults[0].info.title} (${tidalId})`);
        const tracks = await resolveSearch(node, `${DEFAULTS.recommendationPrefixes.tidal}${tidalId}`);
        if (tracks.length > 0) {
            console.log(`[RecommendationFetcher] tdrec (via search) returned ${tracks.length} recommendations.`);
            return tracks;
        }
    }

    console.log('[RecommendationFetcher] Tidal recommendations: no results.');
    return [];
}

// ---------------------------------------------------------------------------
// Cross-Source Resolution
// ---------------------------------------------------------------------------

/**
 * Given a list of candidate tracks (from any source), try to resolve each
 * one on a non-YouTube platform using ISRC or text search.
 * This ensures we play from Deezer/Tidal/AM/SC whenever possible.
 * 
 * @param {object} node — Shoukaku node
 * @param {object[]} candidates — Raw candidates from any source
 * @param {boolean} allowYouTube — Whether to include YouTube as last resort
 * @returns {Promise<object[]>} Candidates with preferred-source replacements
 */
async function crossSourceResolve(node, candidates, allowYouTube) {
    const resolved = [];

    for (const candidate of candidates) {
        if (!candidate || !candidate.info) continue;

        const source = candidate.info.sourceName || '';

        // If already on a preferred source, keep it
        if (['deezer', 'tidal', 'applemusic', 'soundcloud'].includes(source)) {
            resolved.push(candidate);
            continue;
        }

        // Try ISRC-based cross-source match
        if (candidate.info.isrc) {
            const match = await matchByIsrc(node, candidate.info.isrc);
            if (match) {
                resolved.push(match);
                continue;
            }
        }

        // Try text-based cross-source search
        const { artist, title } = parseSoundCloudSeed(candidate.info);
        const providers = [...DEFAULTS.searchProviders];

        let matched = false;
        for (const provider of providers) {
            const results = await resolveSearch(node, `${provider.prefix}${artist} - ${title}`);
            if (results.length > 0) {
                resolved.push(results[0]);
                matched = true;
                break;
            }
        }

        // If nothing else worked and YouTube is allowed, keep the original
        if (!matched) {
            if (allowYouTube || !['youtube', 'youtube-music'].includes(source)) {
                resolved.push(candidate);
            }
        }
    }

    return resolved;
}

// ---------------------------------------------------------------------------
// Non-Premium: Simpler Search-Based Recommendations
// ---------------------------------------------------------------------------

/**
 * Fetch recommendations for non-premium users using simple text search.
 * Tries Apple Music first, then YouTube Music as a fallback.
 * 
 * @param {object} node — Shoukaku node
 * @param {object} seedTrack — The seed track
 * @returns {Promise<object[]>} Array of candidate tracks
 */
async function fetchFallbackRecommendations(node, seedTrack) {
    const info = seedTrack.info || {};
    const { artist, title } = parseSoundCloudSeed(info);

    let candidates = [];

    // For non-premium, searching for "Artist - Title" is too restrictive and often
    // returns only the exact track (which gets filtered out).
    // Searching for the artist provides a pool of their top tracks, which is much better
    // for fallback autoplay.
    if (artist) {
        for (const source of DEFAULTS.fallbackSearchPrefixes) {
            if (candidates.length > 0) break;

            console.log(`[RecommendationFetcher] Non-premium: trying ${source.name} artist search for "${artist}"`);
            const results = await resolveSearch(node, `${source.prefix}${artist}`);

            if (results.length > 0) {
                candidates = results;
                console.log(`[RecommendationFetcher] Non-premium: ${source.name} returned ${results.length} results.`);
            }
        }
    }

    // If no artist (rare) or artist search failed, try the track title
    if (candidates.length === 0 && title) {
        for (const source of DEFAULTS.fallbackSearchPrefixes) {
            if (candidates.length > 0) break;

            console.log(`[RecommendationFetcher] Non-premium: fallback title search for "${title}"`);
            const results = await resolveSearch(node, `${source.prefix}${title}`);

            if (results.length > 0) {
                candidates = results;
                console.log(`[RecommendationFetcher] Non-premium: ${source.name} title search returned ${results.length} results.`);
            }
        }
    }

    return candidates;
}

// ---------------------------------------------------------------------------
// Multi-Source Text Search (shared fallback for both tiers)
// ---------------------------------------------------------------------------

/**
 * Broad multi-source text search — used as a last resort when
 * both dzrec:/tdrec: and platform-specific searches fail.
 * Searches across all configured providers.
 * 
 * @param {object} node — Shoukaku node
 * @param {object} seedTrack — The seed track
 * @param {boolean} isPremium — Whether to include YouTube Music
 * @returns {Promise<object[]>} Array of candidate tracks
 */
async function fetchMultiSourceSearch(node, seedTrack, isPremium) {
    const info = seedTrack.info || {};
    const { artist, title } = parseSoundCloudSeed(info);

    const providers = [...DEFAULTS.searchProviders];
    if (isPremium) {
        providers.push(DEFAULTS.youtubeProvider);
    }

    let candidates = [];

    // ── Artist Search (Best for Fallback) ────────────────────────────────
    // Searching for the exact track only returns 1 result which will be blocked
    // by the history filter. Searching for the artist returns a pool of tracks.
    if (artist) {
        for (const provider of providers) {
            console.log(`[RecommendationFetcher] Multi-source: trying ${provider.name} artist search for "${artist}"`);
            const results = await resolveSearch(node, `${provider.prefix}${artist}`);

            if (results.length > 0) {
                candidates.push(...results);
                // Deduplicate
                candidates = Array.from(new Map(candidates.map(c => [c.info.identifier, c])).values());
                console.log(`[RecommendationFetcher] Multi-source: ${provider.name} found ${results.length} candidates. Total pool: ${candidates.length}`);
            }
        }
    }

    // ── Title Fallback ───────────────────────────────────────────────────
    if (candidates.length < 5 && title) {
        for (const provider of providers) {
            console.log(`[RecommendationFetcher] Multi-source: fallback title search for "${title}"`);
            const results = await resolveSearch(node, `${provider.prefix}${title}`);

            if (results.length > 0) {
                candidates.push(...results);
                candidates = Array.from(new Map(candidates.map(c => [c.info.identifier, c])).values());
                console.log(`[RecommendationFetcher] Multi-source: ${provider.name} title search found ${results.length} candidates.`);
            }
        }
    }

    return candidates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Main entry point: fetch recommendation candidates for autoplay.
 * 
 * Premium flow:
 *   dzrec → tdrec → cross-source resolve → multi-source search fallback
 * 
 * Non-premium flow:
 *   Apple Music search → YouTube Music search → multi-source search fallback
 * 
 * @param {object} node — Shoukaku node
 * @param {object} seedTrack — The currently playing seed track
 * @param {boolean} isPremium — Whether the guild has premium
 * @returns {Promise<object[]>} Raw unfiltered candidates
 */
async function fetchRecommendations(node, seedTrack, isPremium) {
    const seedId = seedTrack.info?.identifier || 'unknown';
    const seedTitle = seedTrack.info?.title || 'unknown';
    console.log(`[RecommendationFetcher] Fetching for: "${seedTitle}" (${seedId}) | Premium: ${isPremium}`);

    let candidates = [];

    if (isPremium) {
        // ── PREMIUM: Platform-native recommendations ─────────────────────
        // Try Deezer recommendations first (best catalog, direct streaming)
        candidates = await fetchDeezerRecommendations(node, seedTrack);

        // If Deezer returned too few candidates, supplement with Tidal recommendations
        if (candidates.length < 15) {
            const tidalTracks = await fetchTidalRecommendations(node, seedTrack);
            candidates.push(...tidalTracks);
            // Deduplicate by identifier
            candidates = Array.from(new Map(candidates.map(c => [c.info.identifier, c])).values());
        }

        // Cross-source resolve: ensure candidates are on preferred platforms
        // (converts YouTube results to Deezer/Tidal/AM/SC when possible)
        if (candidates.length > 0) {
            candidates = await crossSourceResolve(node, candidates, false);
        }
    } else {
        // ── NON-PREMIUM: Simple search-based recommendations ─────────────
        candidates = await fetchFallbackRecommendations(node, seedTrack);
    }

    // ── Shared fallback: multi-source text search ────────────────────────
    // Used when platform-specific recommendations return too few tracks
    if (candidates.length < 10) {
        const fallbackTracks = await fetchMultiSourceSearch(node, seedTrack, isPremium);
        candidates.push(...fallbackTracks);
        // Deduplicate by identifier
        candidates = Array.from(new Map(candidates.map(c => [c.info.identifier, c])).values());
    }

    console.log(`[RecommendationFetcher] Total raw candidates: ${candidates.length}`);
    return candidates;
}

module.exports = {
    fetchRecommendations,
    // Exported for testing and advanced use
    fetchDeezerRecommendations,
    fetchTidalRecommendations,
    fetchFallbackRecommendations,
    fetchMultiSourceSearch,
    crossSourceResolve,
    matchByIsrc,
    resolveSearch,
    parseSoundCloudSeed,
};
