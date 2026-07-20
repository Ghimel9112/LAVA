const { EmbedBuilder } = require('discord.js');
const premiumService = require('../services/premiumService');


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
        const premium = await premiumService.isPremium(guildId);

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

        const getNewTracks = (tracks) => {
            return tracks.filter(t => {
                if (!t || !t.info || t.info.identifier === identifier) return false;
                if (isUnwantedTrack(t.info.title, t.info.author, title, author)) return false;
                
                const sig = getBaseSignature(t.info.author, t.info.title);
                if (history.has(sig)) return false;
                
                // Fuzzy check against history titles
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

        // -----------------------------------------------------------------
        // DEFINE STRATEGIES
        // -----------------------------------------------------------------
        const strategies = [];
        const isYouTube = track.info.sourceName === 'youtube' || track.info.sourceName === 'youtube-music';

        if (premium && !ytDisabled) {
            if (isYouTube) {
                strategies.push({ name: 'YouTube Mix (Same Genre)', type: 'mix' });
            }
            strategies.push(
                { name: 'YouTube Music', prefix: 'ytmsearch:' },
                { name: 'Apple Music', prefix: 'amsearch:' },
                { name: 'SoundCloud', prefix: 'scsearch:' }
            );
        } else {
            strategies.push(
                { name: 'Apple Music', prefix: 'amsearch:' },
                { name: 'SoundCloud', prefix: 'scsearch:' }
            );
        }

        // -----------------------------------------------------------------
        // EXECUTE STRATEGIES
        // -----------------------------------------------------------------
        for (const strategy of strategies) {
            if (candidates.length > 0) break;

            try {
                let query = '';
                if (strategy.type === 'mix') {
                    query = `https://www.youtube.com/watch?v=${identifier}&list=RD${identifier}`;
                } else {
                    query = `${strategy.prefix}${author} - ${title}`;
                }
                
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

        // -----------------------------------------------------------------
        // STRATEGY: Artist Search (Last Resort)
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            try {
                // If premium, prefer ytmsearch for artist fallback, otherwise amsearch
                const prefix = (premium && !ytDisabled) ? 'ytmsearch:' : 'amsearch:';
                const query = `${prefix}${author}`;
                const res = await node.rest.resolve(query);

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
                console.warn(`[Autoplay] Strategy (Artist) failed: ${e.message}`);
            }
        }

        // -----------------------------------------------------------------
        // SELECTION & PLAY
        // -----------------------------------------------------------------
        if (candidates.length === 0) {
            console.log('[Autoplay] All strategies failed. Could not find a track.');
            return null;
        }

        const valid = candidates; // Already filtered for uniqueness
        const randomTrack = valid[Math.floor(Math.random() * valid.length)];

        queue.songs.push(randomTrack);
        const sig = getBaseSignature(randomTrack.info.author, randomTrack.info.title);
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

function getBaseSignature(author, title) {
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
}

module.exports = { handleAutoplay, getBaseSignature };
