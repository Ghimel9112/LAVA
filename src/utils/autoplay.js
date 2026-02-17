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

        const guildId = player.guildId;
        const premium = isPremium(guildId);

        const identifier = track.info.identifier;
        const author = track.info.author;
        const title = track.info.title;

        console.log(`[Autoplay] Seed: ${title} by ${author} (${identifier}) | Premium: ${premium}`);

        let candidates = [];

        // -----------------------------------------------------------------
        // STRATEGY 1: YouTube Mix (PREMIUM ONLY)
        // -----------------------------------------------------------------
        if (premium) {
            try {
                const mixURL = `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`;
                const res = await node.rest.resolve(mixURL);

                if (res && res.data) {
                    let tracks = [];
                    if (Array.isArray(res.data)) tracks = res.data;
                    else if (res.data.tracks) tracks = res.data.tracks;
                    else if (res.tracks) tracks = res.tracks;

                    candidates = tracks.filter(t => t && t.info && t.info.identifier !== identifier);

                    if (candidates.length > 0) {
                        console.log(`[Autoplay] Strategy 1 (Mix) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 1 (Mix) failed: ${e.message}`);
            }
        } else {
            console.log('[Autoplay] Skipping Strategy 1 (Mix) because Safe Mode is enabled.');
        }

        // -----------------------------------------------------------------
        // STRATEGY 2: Recent / Related Search (SAFE MODE Aware)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            try {
                // If Safe Mode (Non-Premium), use Spotify/SoundCloud. If Premium, use YouTube.
                const searchPrefix = premium ? 'ytsearch:' : 'spsearch:';
                const query = `${searchPrefix}${author} - ${title}`;

                const res = await node.rest.resolve(query);

                if (res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t.info.identifier !== identifier);

                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 2 (${premium ? 'YT' : 'Spotify'} Search) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 2 failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 2.5: Safe Mode Fallback to SoundCloud (if Spotify failed)
        // -----------------------------------------------------------------
        if (!premium && candidates.length === 0) {
            try {
                const query = `scsearch:${author} - ${title}`;
                const res = await node.rest.resolve(query);

                if (res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t.info.identifier !== identifier);
                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 2.5 (SoundCloud Search) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 2.5 failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 3: Artist Search (Last Resort)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            try {
                const searchPrefix = premium ? 'ytsearch:' : 'spsearch:';
                // For Spotify, "top tracks" or just the artist name is usually better than "official audio"
                const suffix = premium ? 'official audio' : '';
                const query = `${searchPrefix}${author} ${suffix}`.trim();

                const res = await node.rest.resolve(query);

                if (res && res.data) {
                    let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                    tracks = tracks.filter(t => t.info.identifier !== identifier);

                    if (tracks.length > 0) {
                        candidates = tracks;
                        console.log(`[Autoplay] Strategy 3 (Artist) found ${candidates.length} candidates.`);
                    }
                }
            } catch (e) {
                console.warn(`[Autoplay] Strategy 3 (Artist) failed: ${e.message}`);
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
