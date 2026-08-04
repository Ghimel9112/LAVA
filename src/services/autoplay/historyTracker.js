'use strict';

/**
 * History Tracker — JSON-File-Backed Rolling Play History
 * 
 * Maintains a per-guild list of recently played tracks to prevent repeats.
 * Each entry stores the track's ISRC (most reliable), identifier, and a
 * normalized "author-title" signature for fallback matching.
 * 
 * Deduplication strategy (checked in order):
 *   1. ISRC match — exact, cross-platform (same recording on Deezer/Tidal/etc.)
 *   2. Track ID match — same source, same track
 *   3. Fuzzy title match — Levenshtein distance on normalized titles
 * 
 * Storage:
 *   In-memory cache with JSON file persistence (via cacheStore).
 *   List key: `autoplay:history:{guildId}` — newest entries first (LPUSH).
 *   Trimmed to `historySize` after each add.
 */

const cacheStore = require('../cacheStore');
const { DEFAULTS } = require('./autoplayConfig');

// ---------------------------------------------------------------------------
// Levenshtein Distance (inline — avoids adding an npm dependency for 20 lines)
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 * Used for fuzzy title matching to catch near-duplicates like
 * "Blinding Lights" vs "Blinding Lights!" or minor typos.
 * 
 * @param {string} a
 * @param {string} b
 * @returns {number} Edit distance
 */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Optimization: use single-row DP to save memory
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        let prev = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            const val = Math.min(
                row[j] + 1,       // deletion
                prev + 1,         // insertion
                row[j - 1] + cost // substitution
            );
            row[j - 1] = prev;
            prev = val;
        }
        row[b.length] = prev;
    }

    return row[b.length];
}

// ---------------------------------------------------------------------------
// Title Normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a title for signature comparison.
 * Strips parenthetical info, brackets, common suffixes, and non-alphanumeric chars.
 * 
 * @param {string} title
 * @returns {string} Normalized lowercase alphanumeric string
 */
function normalizeTitle(title) {
    return (title || '').toLowerCase()
        .replace(/\(.*?\)/g, '')              // (Official Video), (feat. X), etc.
        .replace(/\[.*?\]/g, '')              // [Official Audio], etc.
        .replace(/official\s*(video|audio|music\s*video|visualizer|lyric\s*video)?/gi, '')
        .replace(/lyric\s*video/gi, '')
        .replace(/remix/gi, '')
        .replace(/radio\s*edit/gi, '')
        .replace(/[^a-z0-9]/g, '')            // keep only alphanumeric
        .trim();
}

/**
 * Normalize an author name for signature comparison.
 * Strips common suffixes like "- Topic", "VEVO", etc.
 * 
 * @param {string} author
 * @returns {string} Normalized lowercase alphanumeric string
 */
function normalizeAuthor(author) {
    return (author || '').toLowerCase()
        .replace(/\s*-\s*topic$/gi, '')
        .replace(/vevo$/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/**
 * Build a dedup signature from author + title.
 * This is the same concept as the old `getBaseSignature` but with
 * better normalization and structured output.
 * 
 * @param {string} author
 * @param {string} title
 * @returns {string} Signature like "artist-songtitle"
 */
function buildSignature(author, title) {
    return `${normalizeAuthor(author)}-${normalizeTitle(title)}`;
}

// ---------------------------------------------------------------------------
// History Entry Serialization
// ---------------------------------------------------------------------------

/**
 * Create a serializable history entry from a track.
 * 
 * @param {object} track — Lavalink track object with track.info
 * @returns {string} JSON string of { isrc, id, signature }
 */
function serializeEntry(track) {
    const info = track.info || {};
    return JSON.stringify({
        isrc: info.isrc || null,
        id: info.identifier || null,
        signature: buildSignature(info.author, info.title),
        title: normalizeTitle(info.title),
    });
}

/**
 * Parse a serialized history entry.
 * 
 * @param {string} raw — JSON string
 * @returns {{ isrc: string|null, id: string|null, signature: string, title: string }}
 */
function deserializeEntry(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return { isrc: null, id: null, signature: raw, title: '' };
    }
}

// ---------------------------------------------------------------------------
// Redis Key
// ---------------------------------------------------------------------------

function historyKey(guildId) {
    return `autoplay:history:${guildId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const historyTracker = {
    /**
     * Check if a track has been recently played in this guild.
     * 
     * Matching priority:
     *   1. ISRC exact match (most reliable, cross-platform)
     *   2. Track identifier exact match (same source)
     *   3. Fuzzy title+author match (Levenshtein distance ≤ threshold)
     * 
     * @param {string} guildId
     * @param {object} track — Lavalink track with track.info
     * @param {number} [threshold] — Levenshtein threshold (default from config)
     * @returns {Promise<boolean>} True if the track was recently played
     */
    async isPlayed(guildId, track, threshold) {
        const maxDist = threshold ?? DEFAULTS.levenshteinThreshold;
        const info = track.info || {};
        const candidateIsrc = info.isrc || null;
        const candidateId = info.identifier || null;
        const candidateSig = buildSignature(info.author, info.title);
        const candidateTitle = normalizeTitle(info.title);

        const history = await cacheStore.lrange(historyKey(guildId), 0, -1);

        for (const raw of history) {
            const entry = deserializeEntry(raw);

            // 1. ISRC match — same recording across platforms
            if (candidateIsrc && entry.isrc && candidateIsrc === entry.isrc) {
                return true;
            }

            // 2. Exact ID match — same track on same source
            if (candidateId && entry.id && candidateId === entry.id) {
                return true;
            }

            // 3. Exact signature match (normalized author-title)
            if (candidateSig === entry.signature) {
                return true;
            }

            // 4. Fuzzy title match (catches near-duplicates)
            //    Only compare if both titles are long enough to be meaningful
            if (candidateTitle.length > 5 && entry.title && entry.title.length > 5) {
                const dist = levenshtein(candidateTitle, entry.title);
                if (dist <= maxDist) {
                    return true;
                }
            }
        }

        return false;
    },

    /**
     * Record a track as played in this guild's history.
     * The list is trimmed to the configured history size (default 50).
     * 
     * @param {string} guildId
     * @param {object} track — Lavalink track with track.info
     * @param {number} [historySize] — Max entries to keep (default from config)
     */
    async addPlayed(guildId, track, historySize) {
        const maxSize = historySize ?? DEFAULTS.historySize;
        const entry = serializeEntry(track);

        await cacheStore.lpush(historyKey(guildId), entry);
        // Trim to keep only the most recent N entries
        await cacheStore.ltrim(historyKey(guildId), 0, maxSize - 1);
    },

    /**
     * Clear all history for a guild (e.g., on /clearqueue or session reset).
     * 
     * @param {string} guildId
     */
    async clearHistory(guildId) {
        await cacheStore.del(historyKey(guildId));
    },

    /**
     * Filter an array of candidate tracks, removing any that appear in history.
     * Returns only tracks that have NOT been recently played.
     * 
     * @param {string} guildId
     * @param {object[]} candidates — Array of Lavalink tracks
     * @param {number} [threshold] — Levenshtein threshold
     * @returns {Promise<object[]>} Filtered candidates (not played)
     */
    async filterPlayed(guildId, candidates, threshold) {
        const results = [];
        for (const track of candidates) {
            const played = await this.isPlayed(guildId, track, threshold);
            if (!played) {
                results.push(track);
            }
        }
        return results;
    },

    // Exported for use in other modules that need signature building
    buildSignature,
    normalizeTitle,
    normalizeAuthor,
    levenshtein,
};

module.exports = historyTracker;
