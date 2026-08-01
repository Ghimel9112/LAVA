const { EmbedBuilder } = require('discord.js');
const premiumService = require('../services/premiumService');


/**
 * Handles autoplay logic.
 * Primary: YouTube Mix/Radio discovery -> cross-platform match (AM -> Deezer -> Tidal -> SoundCloud)
 * Fallback: Direct multi-source search
 * Non-premium users never use YouTube.
 *
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
        const premium = await premiumService.isPremium(guildId);
        const ytDisabled = client.youtubeDisabled || false;

        const identifier = track.info.identifier;
        const author = track.info.author;
        const title = track.info.title;

        console.log(`[Autoplay] Seed: ${title} by ${author} (${identifier}) | Premium: ${premium}`);

        let candidates = [];
        const history = queue.previousTracks || new Set();

        const isUnwantedTrack = (candidateTitle, candidateAuthor, seedTitle, seedAuthor) => {
            const lowerCandidateTitle = (candidateTitle || '').toLowerCase();
            const lowerCandidateAuthor = (candidateAuthor || '').toLowerCase();
            const lowerSeedTitle = (seedTitle || '').toLowerCase();
            const lowerSeedAuthor = (seedAuthor || '').toLowerCase();

            const unwanted = /\b(remix|mix|live|cover|edit|club|extended|instrumental|karaoke|slowed|reverb|sped up|nightcore|bass boosted|radio)\b/i;

            const titleMatch = lowerCandidateTitle.match(unwanted);
            if (titleMatch) {
                const word = titleMatch[1].toLowerCase();
                if (!lowerSeedTitle.includes(word)) {
                    return true;
                }
            }

            if (lowerCandidateAuthor.includes('dj ') && !lowerSeedAuthor.includes('dj ')) {
                return true;
            }

            return false;
        };

        const getCleanTitle = (title) => {
            return (title || '').toLowerCase()
                .replace(/\(.*?\)/g, '')
                .replace(/\[.*?\]/g, '')
                .replace(/remix/g, '')
                .replace(/mix/g, '')
                .replace(/radio edit/g, '')
                .replace(/official video/g, '')
                .replace(/official audio/g, '')
                .replace(/lyric video/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();
        };

        const getBaseSignature = (author, title) => {
            const cleanTitle = (title || '').toLowerCase()
                .replace(/\(.*?\)/g, '')
                .replace(/\[.*?\]/g, '')
                .replace(/remix/g, '')
                .replace(/mix/g, '')
                .replace(/radio edit/g, '')
                .replace(/official video/g, '')
                .replace(/official audio/g, '')
                .replace(/lyric video/g, '')
                .replace(/[^a-z0-9]/g, '')
                .trim();

            const cleanAuthor = (author || '').toLowerCase()
                .replace(/[^a-z0-9]/g, '')
                .trim();

            return `${cleanAuthor}-${cleanTitle}`;
        };

        const getNewTracks = (tracks) => {
            return tracks.filter(t => {
                if (!t || !t.info || t.info.identifier === identifier) return false;
                if (isUnwantedTrack(t.info.title, t.info.author, title, author)) return false;

                const sig = getBaseSignature(t.info.author, t.info.title);
                if (history.has(sig)) return false;

                const candidateCleanTitle = getCleanTitle(t.info.title);
                if (candidateCleanTitle.length > 5) {
                    for (const pastSig of history) {
                        const pastTitle = pastSig.split('-').slice(1).join('-');
                        if (pastTitle.length > 5 && (candidateCleanTitle.includes(pastTitle) || pastTitle.includes(candidateCleanTitle))) {
                            return false;
                        }
                    }
                }

                return true;
            });
        };

        const cleanAuthor = author
            .replace(/\s*-\s*Topic$/gi, '')
            .replace(/VEVO$/gi, '')
            .trim();

        let searchAuthor = cleanAuthor;
        let searchTitle = title;
        if (track.info.sourceName === 'soundcloud' && title.includes(' - ')) {
            const dashIdx = title.indexOf(' - ');
            const parsedArtist = title.substring(0, dashIdx).trim();
            const parsedTitle = title.substring(dashIdx + 3).trim();
            if (parsedArtist.length > 1 && parsedTitle.length > 1) {
                searchAuthor = parsedArtist;
                searchTitle = parsedTitle;
                console.log(`[Autoplay] SoundCloud seed: real artist="${searchAuthor}", title="${searchTitle}" (uploader was "${cleanAuthor}")`);
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 1: YouTube Mix/Radio discovery -> cross-platform match
        // Only for premium users. YouTube is used ONLY for discovery.
        // -----------------------------------------------------------------
        if (premium && !ytDisabled) {
            const isYouTube = track.info.sourceName === 'youtube' || track.info.sourceName === 'youtube-music';
            let mixUrl = null;

            if (isYouTube) {
                mixUrl = `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`;
                console.log('[Autoplay] Strategy (YouTube Mix - Direct) trying...');
            } else {
                console.log('[Autoplay] Strategy (YouTube Equivalent + Mix) trying...');
                try {
                    const ytSearch = await node.rest.resolve(`ytsearch:${searchAuthor} - ${searchTitle}`);
                    const loadType = ytSearch?.loadType ? ytSearch.loadType.toLowerCase() : '';
                    if (loadType !== 'empty' && loadType !== 'error' && ytSearch?.data?.tracks?.length > 0) {
                        const ytTrack = ytSearch.data.tracks[0];
                        mixUrl = `https://www.youtube.com/watch?v=${ytTrack.info.identifier}&list=RD${ytTrack.info.identifier}`;
                        console.log(`[Autoplay] Found YouTube equivalent: ${ytTrack.info.title} (${ytTrack.info.identifier})`);
                    }
                } catch (e) {
                    console.warn(`[Autoplay] YouTube equivalent search failed: ${e.message}`);
                }
            }

            if (mixUrl) {
                try {
                    const res = await node.rest.resolve(mixUrl);
                    const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                    if (loadType === 'playlist' && res?.data?.tracks?.length > 0) {
                        const ytTracks = res.data.tracks.slice(0, 15);
                        console.log(`[Autoplay] YouTube Mix found ${ytTracks.length} tracks. Finding cross-platform matches...`);

                        const crossPlatformPrefixes = ['amsearch:', 'dzsearch:', 'tidalSearch:', 'scsearch:'];

                        for (const ytTrack of ytTracks) {
                            if (candidates.length > 0) break;
                            if (!ytTrack.info || !ytTrack.info.title) continue;

                            const ytTitle = ytTrack.info.title;
                            const ytAuthor = ytTrack.info.author;

                            for (const prefix of crossPlatformPrefixes) {
                                if (candidates.length > 0) break;
                                try {
                                    const searchRes = await node.rest.resolve(`${prefix}${ytAuthor} - ${ytTitle}`);
                                    const searchLoadType = searchRes?.loadType ? searchRes.loadType.toLowerCase() : '';
                                    if (searchLoadType !== 'empty' && searchLoadType !== 'error' && searchRes?.data) {
                                        let tracks = Array.isArray(searchRes.data) ? searchRes.data : (searchRes.data.tracks || []);
                                        tracks = getNewTracks(tracks);
                                        if (tracks.length > 0) {
                                            candidates = tracks;
                                            console.log(`[Autoplay] YouTube Mix track "${ytTitle}" matched on ${prefix} -> playing from there.`);
                                        }
                                    }
                                } catch (e) {
                                    console.warn(`[Autoplay] Cross-platform search ${prefix} failed: ${e.message}`);
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[Autoplay] YouTube Mix failed: ${e.message}`);
                }
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 2: Direct multi-source search (Fallback)
        // Non-premium: AM -> Deezer -> Tidal -> SoundCloud
        // Premium: AM -> Deezer -> Tidal -> SoundCloud -> YouTube Music
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            const strategies = [
                { name: 'Apple Music', prefix: 'amsearch:' },
                { name: 'Deezer', prefix: 'dzsearch:' },
                { name: 'Tidal', prefix: 'tidalSearch:' },
                { name: 'SoundCloud', prefix: 'scsearch:' },
            ];
            if (premium && !ytDisabled) {
                strategies.push({ name: 'YouTube Music', prefix: 'ytmsearch:' });
            }

            console.log(`[Autoplay] Direct search (${strategies.map(s => s.name).join(' -> ')})...`);

            for (const strategy of strategies) {
                if (candidates.length > 0) break;

                try {
                    const query = `${strategy.prefix}${searchAuthor} - ${searchTitle}`;
                    const res = await node.rest.resolve(query);

                    const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                    if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                        let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                        let newTracks = getNewTracks(tracks);

                        if (newTracks.length > 0) {
                            candidates = newTracks;
                            console.log(`[Autoplay] Strategy (${strategy.name}) found ${candidates.length} new candidates.`);
                        }
                    }
                } catch (e) {
                    console.warn(`[Autoplay] Strategy (${strategy.name}) failed: ${e.message}`);
                }
            }
        }

        // -----------------------------------------------------------------
        // STRATEGY 3: Artist Search (Last Resort)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            const artistPrefixes = ['amsearch:', 'dzsearch:', 'tidalSearch:', 'scsearch:'];
            if (premium && !ytDisabled) artistPrefixes.push('ytmsearch:');

            for (const prefix of artistPrefixes) {
                if (candidates.length > 0) break;
                try {
                    const res = await node.rest.resolve(`${prefix}${searchAuthor}`);
                    const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                    if (loadType !== 'empty' && loadType !== 'error' && res && res.data) {
                        let tracks = Array.isArray(res.data) ? res.data : (res.data.tracks || []);
                        let newTracks = getNewTracks(tracks);
                        if (newTracks.length > 0) {
                            candidates = newTracks;
                            console.log(`[Autoplay] Strategy (Artist - ${prefix}) found ${candidates.length} new candidates.`);
                        }
                    }
                } catch (e) {
                    console.warn(`[Autoplay] Strategy (Artist - ${prefix}) failed: ${e.message}`);
                }
            }
        }

        // -----------------------------------------------------------------
        // SELECTION & PLAY
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            console.log('[Autoplay] All strategies failed. Could not find a track.');
            return null;
        }

        const valid = candidates;
        const randomTrack = valid[Math.floor(Math.random() * valid.length)];

        const sig = getBaseSignature(randomTrack.info.author, randomTrack.info.title);
        queue.previousTracks.add(sig);

        return randomTrack;

    } catch (error) {
        console.error('[Autoplay] Critical error:', error);
        return null;
    }
}

module.exports = { handleAutoplay, getBaseSignature };
