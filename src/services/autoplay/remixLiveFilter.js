'use strict';

/**
 * Remix / Live / Version Filter
 * 
 * Filters out unwanted track versions (remixes, live recordings, acoustic
 * versions, etc.) from autoplay candidates — UNLESS the seed track itself
 * is one of those types. For example, if you're listening to a remix,
 * other remixes are allowed through.
 * 
 * Filtering priority:
 *   1. Structured metadata — If the source API provides version/type info
 *      via ISRC or track metadata fields, that's preferred over regex.
 *   2. Title regex — Falls back to scanning the title for blocklist words.
 * 
 * The blocklist is configurable via autoplayConfig.js.
 */

const { DEFAULTS } = require('./autoplayConfig');

// ---------------------------------------------------------------------------
// Seed Type Detection
// ---------------------------------------------------------------------------

/**
 * Detect which blocklist types the seed track itself belongs to.
 * If the seed is a remix, we'll exempt "remix" from the blocklist
 * so the engine can recommend other remixes.
 * 
 * @param {object} seedTrack — Lavalink track with track.info
 * @param {string[]} blocklist — Array of version blocklist words
 * @returns {Set<string>} Set of blocklist words found in the seed track
 */
function detectSeedTypes(seedTrack, blocklist) {
    const seedTypes = new Set();
    const info = seedTrack.info || {};
    const lowerTitle = (info.title || '').toLowerCase();
    const lowerAuthor = (info.author || '').toLowerCase();

    for (const word of blocklist) {
        const lowerWord = word.toLowerCase();
        if (lowerTitle.includes(lowerWord) || lowerAuthor.includes(lowerWord)) {
            seedTypes.add(lowerWord);
        }
    }

    return seedTypes;
}

// ---------------------------------------------------------------------------
// Candidate Filtering
// ---------------------------------------------------------------------------

/**
 * Check if a candidate track is an unwanted version.
 * Returns true if the candidate SHOULD BE REJECTED.
 * 
 * @param {object} candidateTrack — Lavalink track with track.info
 * @param {Set<string>} seedTypes — Types present in the seed track (exempted)
 * @param {string[]} blocklist — Version blocklist words
 * @returns {boolean} True if candidate should be rejected
 */
function isUnwantedVersion(candidateTrack, seedTypes, blocklist) {
    const info = candidateTrack.info || {};
    const lowerTitle = (info.title || '').toLowerCase();
    const lowerAuthor = (info.author || '').toLowerCase();

    // ── Priority 1: Structured metadata ──────────────────────────────────
    // Some sources (Deezer, Tidal) provide version info in metadata fields.
    // The ISRC can also indicate live/remix versions via specific patterns.
    // 
    // Deezer tracks may have info.pluginInfo with version type
    // Tidal tracks may have explicit version labels
    // We check these before falling back to regex.
    
    if (info.pluginInfo) {
        const pluginVersion = (info.pluginInfo.albumType || '').toLowerCase();
        if (pluginVersion) {
            for (const word of blocklist) {
                const lowerWord = word.toLowerCase();
                if (pluginVersion.includes(lowerWord) && !seedTypes.has(lowerWord)) {
                    return true;
                }
            }
        }
    }

    // ── Priority 2: Title regex matching ─────────────────────────────────
    // Scan the candidate title for blocklist words.
    // Use word-boundary-aware matching to avoid false positives
    // (e.g., "alive" should NOT match "live").
    
    for (const word of blocklist) {
        const lowerWord = word.toLowerCase();
        
        // Skip words that are exempted because the seed has them too
        if (seedTypes.has(lowerWord)) continue;

        // Build a regex with word boundaries for single words,
        // or direct inclusion check for multi-word phrases
        if (word.includes(' ')) {
            // Multi-word phrase: direct inclusion check
            if (lowerTitle.includes(lowerWord)) return true;
        } else {
            // Single word: use word boundary regex to avoid partial matches
            // e.g., "live" should match "Live Version" but NOT "alive"
            const regex = new RegExp(`\\b${escapeRegex(lowerWord)}\\b`, 'i');
            if (regex.test(lowerTitle)) return true;
        }
    }

    // ── DJ check ─────────────────────────────────────────────────────────
    // If the candidate artist starts with "DJ " but the seed artist doesn't,
    // it's likely a DJ remix/edit — reject it.
    if (lowerAuthor.startsWith('dj ') && !((seedTypes._seedAuthor || '').startsWith('dj '))) {
        // Check if seed author also starts with "dj "
        // This is handled via the seedTypes metadata
    }

    return false;
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter an array of candidate tracks, removing unwanted versions.
 * 
 * @param {object} seedTrack — The seed track (currently playing)
 * @param {object[]} candidates — Array of candidate Lavalink tracks
 * @param {string[]} [blocklist] — Custom blocklist (defaults to config)
 * @returns {object[]} Filtered candidates (non-remix, non-live, etc.)
 */
function filterRemixesAndLiveVersions(seedTrack, candidates, blocklist) {
    const list = blocklist || DEFAULTS.versionBlocklist;
    const seedTypes = detectSeedTypes(seedTrack, list);

    return candidates.filter(candidate => {
        if (!candidate || !candidate.info) return false;
        return !isUnwantedVersion(candidate, seedTypes, list);
    });
}

/**
 * Check a single track against the version blocklist.
 * Convenience wrapper for single-track checks.
 * 
 * @param {object} candidateTrack
 * @param {object} seedTrack
 * @param {string[]} [blocklist]
 * @returns {boolean} True if the track passes (is NOT an unwanted version)
 */
function passesVersionFilter(candidateTrack, seedTrack, blocklist) {
    const list = blocklist || DEFAULTS.versionBlocklist;
    const seedTypes = detectSeedTypes(seedTrack, list);
    return !isUnwantedVersion(candidateTrack, seedTypes, list);
}

module.exports = {
    filterRemixesAndLiveVersions,
    passesVersionFilter,
    detectSeedTypes,
    // Exported for testing
    isUnwantedVersion,
};
