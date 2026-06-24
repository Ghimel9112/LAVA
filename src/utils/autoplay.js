const { EmbedBuilder } = require('discord.js');
const { isPremium } = require('./db');

/**
 * Handles autoplay logic with Safe Mode for non-premium guilds.
 * @param {object} client - The Discord client.
 * @param {object} player - The Shoukaku player.
 * @param {object} track - The track that just finished playing (seed).
 * @param {object} queue - The queue object.
 */
async function handleAutoplay(client, player, track, queue) {
    try {
        if (!track || !track.info || !track.info.identifier) return;

        const node = client.shoukaku.getIdealNode();
        if (!node) return;

        const ytDisabled = client.youtubeDisabled || false;

        const guildId = player.guildId;
        const premium = isPremium(guildId);

        const identifier = track.info.identifier;
        const author = track.info.author;
        const title = track.info.title;

        console.log(`[Autoplay] Seed: ${title} by ${author} (${identifier}) | Premium: ${premium}`);

        let candidates = [];

        // -----------------------------------------------------------------
        // STRATEGY 1: Apple Music Search (Primary - works everywhere)
        // -----------------------------------------------------------------
        try {
            const query = `amsearch:${author} - ${title}`;
            const res = await node.rest.resolve(query);

            const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
            if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                tracks = tracks.filter(t => t && t.info && t.info.identifier !== identifier);

                if (tracks.length > 0) {
                    candidates = tracks;
                    console.log(`[Autoplay] Strategy 1 (Apple Music) found ${candidates.length} candidates.`);
                }
            }
        } catch (e) {
            console.warn(`[Autoplay] Strategy 1 (Apple Music) failed: ${e.message}`);
        }

        // -----------------------------------------------------------------
        // STRATEGY 2: SoundCloud Search (Fallback)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            try {
                const query = `scsearch:${author} - ${title}`;
                const res = await node.rest.resolve(query);

                const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t && t.info && t.info.identifier !== identifier);

                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 2 (SoundCloud) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 2 (SoundCloud) failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 3: YouTube Search (Only if enabled and other sources failed)
        // -----------------------------------------------------------------
        if (candidates.length === 0 && !ytDisabled) {
            try {
                const query = `ytsearch:${author} - ${title}`;
                const res = await node.rest.resolve(query);

                const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t && t.info && t.info.identifier !== identifier);

                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 3 (YouTube) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 3 (YouTube) failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 4: Artist Search on Apple Music (Last Resort)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            try {
                const query = `amsearch:${author}`;
                const res = await node.rest.resolve(query);

                const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t && t.info && t.info.identifier !== identifier);

                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 4 (Artist - Apple Music) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 4 (Artist) failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // SELECTION & PLAY
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            console.log('[Autoplay] All strategies failed. Could not find a track.');
            return null;
        }

        const history = queue.previousTracks || new Set();
        let valid = candidates.filter(t => {
            const sig = `${t.info.author} - ${t.info.title}`.toLowerCase();
            return !history.has(sig);
        });

        if (valid.length === 0) valid = candidates;

        const randomTrack = valid[Math.floor(Math.random() * valid.length)];

        queue.songs.push(randomTrack);
        const sig = `${randomTrack.info.author} - ${randomTrack.info.title}`.toLowerCase();
        queue.previousTracks.add(sig);

        if (queue.textChannel) {
            // Optional logging/embed here
        }

        return randomTrack;

    } catch (error) {
        console.error('[Autoplay] Critical error:', error);
        return null;
    }
}

module.exports = handleAutoplay;
