'use strict';

/**
 * Autoplay Engine Configuration
 * 
 * Centralizes all tunable parameters for the recommendation engine.
 * Values are read from environment variables with sensible defaults.
 * Per-guild overrides can be stored in Redis (future: /autoplay config command).
 * 
 * All thresholds and blocklists are exported as a frozen config object
 * so they can't be accidentally mutated at runtime.
 */

const cacheStore = require('../cacheStore');

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

const DEFAULTS = {
    // ── Rolling History ──────────────────────────────────────────────────
    // How many tracks to remember per guild for dedup.
    // 50 tracks ≈ 3-4 hours of listening at ~4 min/track.
    historySize: parseInt(process.env.AUTOPLAY_HISTORY_SIZE, 10) || 50,

    // Levenshtein distance threshold for fuzzy title matching.
    // ≤ 3 catches typos and minor variations like "Song" vs "Song!"
    levenshteinThreshold: 3,

    // ── Genre / Language Filtering ───────────────────────────────────────
    // Minimum Jaccard similarity between seed and candidate genre tags.
    // 0.2 = at least ~1 overlapping tag out of top 5.
    genreOverlapThreshold: parseFloat(process.env.AUTOPLAY_GENRE_THRESHOLD) || 0.2,

    // Number of top genre tags to compare from Last.fm.
    topTagCount: 5,

    // Last.fm API key — REQUIRED for genre filtering.
    // Register at https://www.last.fm/api/account/create
    lastfmApiKey: process.env.LASTFM_API_KEY || '',

    // Last.fm tag cache TTL in seconds (24 hours).
    // Tags rarely change, so long TTL is fine.
    lastfmCacheTTL: 86400,

    // Minimum confidence for language detection (franc returns 0-1).
    // Below this threshold, language filtering is skipped to avoid
    // false rejections. 0.7 is a safe conservative threshold.
    languageConfidenceThreshold: 0.7,

    // ── Remix / Live / Version Filtering ─────────────────────────────────
    // Words that indicate unwanted track versions.
    // If a candidate's title contains any of these (and the seed doesn't),
    // the candidate is rejected.
    versionBlocklist: [
        'remix',
        'live',
        'live session',
        'acoustic',
        'concert',
        'vip mix',
        'rework',
        'edit',
        'instrumental',
        'karaoke',
        'slowed',
        'reverb',
        'sped up',
        'nightcore',
        'bass boosted',
        'radio edit',
        'cover',
        'club mix',
        'extended mix',
        'dub mix',
        'stripped',
        'unplugged',
    ],

    // ── Provider Fallback Chain ──────────────────────────────────────────
    // Order in which sources are tried for cross-source matching.
    // ISRC-based lookups are always tried first within each source.
    // YouTube/YouTube Music are strictly last-resort.
    searchProviders: [
        { name: 'Deezer',       prefix: 'dzsearch:' },
        { name: 'Tidal',        prefix: 'tidalSearch:' },
        { name: 'Apple Music',  prefix: 'amsearch:' },
        { name: 'SoundCloud',   prefix: 'scsearch:' },
    ],

    // YouTube Music is only appended for premium users as absolute last resort
    youtubeProvider: { name: 'YouTube Music', prefix: 'ytmsearch:' },

    // ── Recommendation Sources ───────────────────────────────────────────
    // Premium mode: native platform recommendation queries via LavaSrc.
    // dzrec:{trackId} and tdrec:{trackId} return "related tracks" directly
    // from Deezer/Tidal's recommendation algorithms — no YouTube needed.
    recommendationPrefixes: {
        deezer: 'dzrec:',    // Deezer recommendations by track ID
        tidal:  'tdrec:',    // Tidal recommendations by track ID
    },

    // Non-premium fallback search prefixes (simpler text-based search)
    fallbackSearchPrefixes: [
        { name: 'Apple Music', prefix: 'amsearch:' },
        { name: 'YouTube Music', prefix: 'ytmsearch:' },
    ],

    // ── Source Scoring ────────────────────────────────────────────────────
    // Higher score = preferred source when multiple candidates are available.
    // This incentivizes non-YouTube sources.
    sourceScores: {
        'deezer':        1.0,
        'tidal':         0.95,
        'applemusic':    0.85,
        'soundcloud':    0.7,
        'youtube-music': 0.3,
        'youtube':       0.1,
    },
};

// ---------------------------------------------------------------------------
// Per-guild config overrides (stored in cache)
// ---------------------------------------------------------------------------

/**
 * Load per-guild overrides from cache.
 * Returns merged config (defaults + overrides).
 * 
 * @param {string} guildId
 * @returns {Promise<object>} Merged configuration
 */
async function getGuildConfig(guildId) {
    const config = { ...DEFAULTS };

    try {
        const raw = await cacheStore.get(`autoplay:config:${guildId}`);
        if (raw) {
            const overrides = JSON.parse(raw);
            // Only allow overriding safe, tunable fields
            if (overrides.historySize) config.historySize = overrides.historySize;
            if (overrides.genreOverlapThreshold) config.genreOverlapThreshold = overrides.genreOverlapThreshold;
            if (overrides.topTagCount) config.topTagCount = overrides.topTagCount;
            if (overrides.languageConfidenceThreshold) config.languageConfidenceThreshold = overrides.languageConfidenceThreshold;
            if (overrides.versionBlocklist) config.versionBlocklist = overrides.versionBlocklist;
        }
    } catch (err) {
        console.warn(`[AutoplayConfig] Failed to load guild overrides for ${guildId}: ${err.message}`);
    }

    return config;
}

/**
 * Save per-guild config overrides to cache.
 * 
 * @param {string} guildId
 * @param {object} overrides — Partial config object with fields to override
 */
async function setGuildConfig(guildId, overrides) {
    try {
        await cacheStore.set(
            `autoplay:config:${guildId}`,
            JSON.stringify(overrides)
        );
    } catch (err) {
        console.warn(`[AutoplayConfig] Failed to save guild overrides for ${guildId}: ${err.message}`);
    }
}

module.exports = {
    DEFAULTS,
    getGuildConfig,
    setGuildConfig,
};
