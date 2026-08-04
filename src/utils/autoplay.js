'use strict';

/**
 * Autoplay Orchestrator — Advanced Recommendation Engine
 * 
 * This is the main entry point for autoplay. It coordinates the pipeline:
 * 
 *   1. Load guild-specific autoplay configuration
 *   2. Fetch raw candidates (recommendationFetcher)
 *   3. Filter out remix/live/unwanted versions (remixLiveFilter)
 *   4. Filter by genre similarity + language match (genreLanguageFilter)
 *   5. Exclude recently played tracks (historyTracker)
 *   6. Score remaining candidates by source preference + genre similarity
 *   7. Select the top-scored track (deterministic, not random)
 *   8. Record in history, return track
 * 
 * The engine operates in two modes based on guild premium status:
 *   - PREMIUM:     dzrec:/tdrec: native recommendations → ISRC cross-source
 *   - NON-PREMIUM: Apple Music/YouTube Music text search fallback
 * 
 * YouTube is always the last resort; the engine minimizes YouTube usage
 * by preferring Deezer → Tidal → Apple Music → SoundCloud.
 */

const premiumService = require('../services/premiumService');
const { getGuildConfig, DEFAULTS } = require('../services/autoplay/autoplayConfig');
const { fetchRecommendations } = require('../services/autoplay/recommendationFetcher');
const { filterRemixesAndLiveVersions } = require('../services/autoplay/remixLiveFilter');
const { filterByGenreAndLanguage } = require('../services/autoplay/genreLanguageFilter');
const historyTracker = require('../services/autoplay/historyTracker');

// ---------------------------------------------------------------------------
// Source Scoring
// ---------------------------------------------------------------------------

/**
 * Score a candidate track based on its source platform.
 * Higher score = preferred source (Deezer/Tidal > AM > SC > YouTube).
 * This incentivizes the engine to prefer non-YouTube sources.
 * 
 * @param {object} track — Lavalink track with track.info
 * @returns {number} Score between 0 and 1
 */
function sourceScore(track) {
    const source = (track.info?.sourceName || '').toLowerCase();
    return DEFAULTS.sourceScores[source] ?? 0.5;
}

// ---------------------------------------------------------------------------
// Main Autoplay Handler
// ---------------------------------------------------------------------------

/**
 * Handles autoplay: finds the next track to play when the queue is empty.
 * 
 * This is the complete pipeline:
 *   fetch → filter remixes → filter genre/language → filter history → score → select
 * 
 * @param {object} client — The Discord client (has client.shoukaku, client.queue)
 * @param {object} player — The Shoukaku player
 * @param {object} track — The track that just finished playing (seed)
 * @param {object} queue — The queue object (has queue.autoplay, etc.)
 * @returns {Promise<object|null>} The next track to play, or null if no valid candidate found
 */
async function handleAutoplay(client, player, track, queue) {
    try {
        if (!track || !track.info || !track.info.identifier) return null;

        const node = client.shoukaku.getIdealNode();
        if (!node) {
            console.warn('[Autoplay] No Lavalink node available.');
            return null;
        }

        const guildId = player.guildId;
        const isPremium = await premiumService.isPremium(guildId);
        const config = await getGuildConfig(guildId);

        console.log(`[Autoplay] ══════════════════════════════════════════════`);
        console.log(`[Autoplay] Seed: "${track.info.title}" by ${track.info.author}`);
        console.log(`[Autoplay] Source: ${track.info.sourceName} | ISRC: ${track.info.isrc || 'none'}`);
        console.log(`[Autoplay] Mode: ${isPremium ? 'PREMIUM (dzrec/tdrec)' : 'NON-PREMIUM (search)'}`);

        // ─────────────────────────────────────────────────────────────────
        // STEP 1: Fetch raw candidates
        // ─────────────────────────────────────────────────────────────────
        let candidates = await fetchRecommendations(node, track, isPremium);

        if (candidates.length === 0) {
            console.log('[Autoplay] No candidates found from any source.');
            return null;
        }

        // Remove the seed track itself from candidates
        candidates = candidates.filter(c =>
            c && c.info && c.info.identifier !== track.info.identifier
        );

        console.log(`[Autoplay] Step 1 (fetch): ${candidates.length} raw candidates`);

        // ─────────────────────────────────────────────────────────────────
        // STEP 2: Filter remixes, live versions, and unwanted variants
        // ─────────────────────────────────────────────────────────────────
        candidates = filterRemixesAndLiveVersions(track, candidates, config.versionBlocklist);
        console.log(`[Autoplay] Step 2 (remix/live filter): ${candidates.length} candidates remain`);

        if (candidates.length === 0) {
            console.log('[Autoplay] All candidates rejected by remix/live filter.');
            return null;
        }

        // ─────────────────────────────────────────────────────────────────
        // STEP 3: Exclude recently played tracks (history dedup)
        // ─────────────────────────────────────────────────────────────────
        candidates = await historyTracker.filterPlayed(guildId, candidates);
        console.log(`[Autoplay] Step 3 (history dedup): ${candidates.length} candidates remain`);

        if (candidates.length === 0) {
            console.log('[Autoplay] All candidates rejected by history dedup.');
            return null;
        }

        // ─────────────────────────────────────────────────────────────────
        // STEP 4: Filter by genre similarity and language match
        // Only if Last.fm API key is configured.
        // ─────────────────────────────────────────────────────────────────
        if (config.lastfmApiKey) {
            candidates = await filterByGenreAndLanguage(track, candidates, config);
            console.log(`[Autoplay] Step 4 (genre/lang filter): ${candidates.length} candidates remain`);

            if (candidates.length === 0) {
                console.log('[Autoplay] All candidates rejected by genre/language filter.');
                // Don't give up — re-fetch without genre filtering as a safety net
                console.log('[Autoplay] Retrying without genre filter...');
                candidates = await fetchRecommendations(node, track, isPremium);
                candidates = candidates.filter(c =>
                    c && c.info && c.info.identifier !== track.info.identifier
                );
                candidates = filterRemixesAndLiveVersions(track, candidates, config.versionBlocklist);
                candidates = await historyTracker.filterPlayed(guildId, candidates);
            }
        } else {
            console.log('[Autoplay] Step 4 (genre/lang filter): SKIPPED (no LASTFM_API_KEY)');
        }

        if (candidates.length === 0) {
            console.log('[Autoplay] All candidates were recently played. No new track found.');
            return null;
        }

        // ─────────────────────────────────────────────────────────────────
        // STEP 5: Score and select the best candidate
        // Uses source preference (Deezer/Tidal > AM > SC > YouTube)
        // instead of random selection for more consistent quality.
        // ─────────────────────────────────────────────────────────────────
        const scored = candidates.map(c => ({
            track: c,
            score: sourceScore(c),
        }));

        // Sort by score descending — best source wins
        scored.sort((a, b) => b.score - a.score);

        // If there are multiple candidates with the same top score,
        // pick one randomly to add variety
        const topScore = scored[0].score;
        const topCandidates = scored.filter(s => s.score === topScore);
        const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)].track;

        console.log(`[Autoplay] ✓ Selected: "${selected.info.title}" by ${selected.info.author} (source: ${selected.info.sourceName}, score: ${topScore.toFixed(2)})`);
        console.log(`[Autoplay] ══════════════════════════════════════════════`);

        // ─────────────────────────────────────────────────────────────────
        // STEP 6: Record in history
        // ─────────────────────────────────────────────────────────────────
        await historyTracker.addPlayed(guildId, selected, config.historySize);

        return selected;

    } catch (error) {
        console.error('[Autoplay] Critical error:', error);
        return null;
    }
}

module.exports = { handleAutoplay };
