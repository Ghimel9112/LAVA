const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const YouTube = require('youtube-sr').default;
const premiumService = require('../../services/premiumService');
const { attachPlayerEvents, cleanTitle, isRemixOrLive } = require('../../utils/playerSetup');
const historyTracker = require('../../services/autoplay/historyTracker');

// Extracts meaningful words from a string for comparison
function extractWords(str) {
    if (!str) return [];
    return str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !['the', 'a', 'an', 'and', 'or', 'of', 'in', 'to', 'for', 'by', 'on', 'is', 'it'].includes(w));
}

// Scores how well two strings match (0-1, higher = better)
function matchScore(candidate, query) {
    if (!candidate || !query) return 0;
    const cWords = extractWords(candidate);
    const qWords = extractWords(query);
    if (qWords.length === 0 || cWords.length === 0) return 0;

    // Count how many query words appear in the candidate
    let matches = 0;
    for (const qw of qWords) {
        if (cWords.some(cw => cw.includes(qw) || qw.includes(cw))) {
            matches++;
        }
    }

    // Score = ratio of matched query words, with a bonus for exact containment
    const ratio = matches / qWords.length;

    // Bonus: check exact normalized containment
    const normC = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normQ = query.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normC.includes(normQ) || normQ.includes(normC)) return Math.max(ratio, 0.8);

    return ratio;
}

// ---------------------------------------------------------
// MAIN COMMAND
// ---------------------------------------------------------

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('The song name or URL')
                .setRequired(true)),
    async execute(interaction) {
        await interaction.deferReply();

        const guildId = interaction.guild.id;
        const { channel } = interaction.member.voice;
        if (!channel) return interaction.editReply('You need to be in a voice channel to play music!');

        const permissions = channel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.editReply('I need the **Connect** and **Speak** permissions in that voice channel!');
        }

        let query = interaction.options.getString('query');
        const node = interaction.client.shoukaku.getIdealNode();
        if (!node) return interaction.editReply('No Lavalink node is available.');

        // Block YouTube URLs if YouTube sources are globally disabled
        const isYouTubeUrl = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(query);
        if (interaction.client.youtubeDisabled && isYouTubeUrl) {
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setDescription('⚠️ YouTube sources are temporarily disabled. The bot requires an update that is not yet available. Please use a song name, Spotify link, or SoundCloud link instead.');
            return interaction.editReply({ embeds: [embed] });
        }

        // 1. RESOLVE SEARCH
        let searchResult;
        const isPremium = await premiumService.isPremium(interaction.guild.id);
        console.log(`[DEBUG] Guild: ${interaction.guild.id}, Premium: ${isPremium}, Query: ${query}`);

        if (isPremium) {
            // premium: try direct resolution first for URLs (Spotify, SoundCloud, etc.)
            // For text queries, prioritize Apple Music to avoid YouTube blocks
            const isUrl = /^https?:\/\//.test(query);
            
            if (isUrl) {
                const res = await node.rest.resolve(query);
                console.log(`[DEBUG] Premium Direct Resolve (URL): type=${res?.loadType}, dataIsArray=${Array.isArray(res?.data)}`);

                // Handle both v4 (data) and v3 (tracks) structures
                const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                const rawData = res?.data || res?.tracks; // v4 uses data, v3 uses tracks

                if (rawData) {
                    // If it's a playlist or a direct track URL
                    // v4: loadType='playlist' or 'search', data is { tracks: [...] } or [...]
                    // v3: loadType='PLAYLIST_LOADED', tracks is [...]

                    if (loadType === 'playlist' || loadType === 'playlist_loaded') {
                        // PLAYLIST: queue ALL tracks
                        let tracks = [];
                        if (Array.isArray(rawData)) {
                            tracks = rawData;
                        } else if (rawData.tracks && Array.isArray(rawData.tracks)) {
                            tracks = rawData.tracks;
                        }

                        // Filter to only valid tracks
                        tracks = tracks.filter(t => t && t.info && t.info.title);

                        if (tracks.length > 0) {
                            const playlistName = rawData.info?.name || 'Unknown Playlist';
                            searchResult = { loadType: 'playlist', data: tracks[0], allTracks: tracks, playlistName };
                        }
                    } else if (loadType === 'track' || loadType === 'track_loaded' || loadType === 'short') {
                        // v4: data is track object
                        // v3: tracks is array of 1 track
                        if (Array.isArray(rawData)) {
                            searchResult = { loadType: 'track', data: rawData[0] };
                        } else {
                            searchResult = { loadType: 'track', data: rawData };
                        }
                    }
                }
            } else {
                // Text query: try Apple Music -> Deezer -> Tidal -> YouTube (minimize YouTube)
                const strategies = [
                    { name: 'Apple Music', prefix: 'amsearch:' },
                    { name: 'Deezer', prefix: 'dzsearch:' },
                    { name: 'Tidal', prefix: 'tidalSearch:' },
                ];
                if (!interaction.client.youtubeDisabled) {
                    strategies.push({ name: 'YouTube', prefix: 'ytsearch:' });
                }

                for (const strategy of strategies) {
                    if (searchResult) break;
                    try {
                        const res = await node.rest.resolve(`${strategy.prefix}${query}`);
                        const loadType = res?.loadType ? res.loadType.toLowerCase() : '';
                        const rawData = res?.data || res?.tracks;
                        if (rawData && loadType !== 'empty' && loadType !== 'error') {
                            let tracks = Array.isArray(rawData) ? rawData : (rawData.tracks || []);
                            tracks = tracks.filter(t => t && t.info && t.info.title);
                            if (tracks.length > 0) {
                                searchResult = { loadType: 'track', data: tracks[0] };
                                console.log(`[DEBUG] Premium ${strategy.name} match: ${tracks[0].info.title}`);
                            }
                        }
                    } catch (e) {
                        console.warn(`[DEBUG] Premium ${strategy.name} search failed: ${e.message}`);
                    }
                }
            }
        }

        // If not premium OR if premium search failed,
        // Fallback to Safe Mode (Apple Music priority)
        if (!searchResult) {
            // Check if this is a Spotify/platform playlist URL (try direct resolve first)
            if (/^https?:\/\//.test(query)) {
                const directRes = await node.rest.resolve(query);
                const directLoadType = directRes?.loadType ? directRes.loadType.toLowerCase() : '';
                const directData = directRes?.data || directRes?.tracks;

                if (directData && (directLoadType === 'playlist' || directLoadType === 'playlist_loaded')) {
                    let tracks = [];
                    if (Array.isArray(directData)) {
                        tracks = directData;
                    } else if (directData.tracks && Array.isArray(directData.tracks)) {
                        tracks = directData.tracks;
                    }
                    tracks = tracks.filter(t => t && t.info && t.info.title);

                    if (tracks.length > 0) {
                        const playlistName = directData.info?.name || 'Unknown Playlist';
                        searchResult = { loadType: 'playlist', data: tracks[0], allTracks: tracks, playlistName };
                    }
                }
            }
        }

        // Universal Safe Mode single-track search (Apple Music primary, SoundCloud fallback)
        if (!searchResult) {
            let songTitle = '', songAuthor = '';
            if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/.test(query)) {
                try {
                    const idMatch = query.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=)|music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/);
                    const videoId = idMatch ? idMatch[1] : query;
                    let info = null;
                    
                    try {
                        info = await YouTube.getVideo(idMatch ? `https://www.youtube.com/watch?v=${videoId}` : query);
                    } catch (e) {
                        // youtube-sr is blocked, fallback to official YouTube oEmbed API for metadata
                        try {
                            const oEmbedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
                            if (oEmbedRes.ok) {
                                const oEmbedData = await oEmbedRes.json();
                                info = { title: oEmbedData.title, channel: { name: oEmbedData.author_name } };
                            }
                        } catch (oEmbedErr) {
                            console.error('oEmbed fallback failed:', oEmbedErr.message);
                        }
                    }

                    if (info && info.title) {
                        songTitle = cleanTitle(info.title);
                        songAuthor = (info.channel?.name || '').replace(/\s*-\s*Topic$/gi, '').replace(/VEVO$/gi, '').trim();
                    } else {
                        throw new Error('No metadata returned from any source');
                    }
                } catch (error) { 
                    console.error('YouTube metadata error:', error.message || error); 
                }
            } else {
                // Try to split "artist - title" format from user input
                const dashSplit = query.match(/^(.+?)\s*[-–—]\s*(.+)$/);
                if (dashSplit) {
                    songAuthor = dashSplit[1].trim();
                    songTitle = dashSplit[2].trim();
                } else {
                    songTitle = query;
                    songAuthor = '';
                }
            }

            // If the query is a URL and we failed to extract a title, abort instead of searching SC/AM for a URL string
            if (!songTitle && /^https?:\/\//.test(query)) {
                return interaction.editReply('⚠️ Could not extract song information from the provided link to find a fallback.');
            }

            const audioQuery = (songTitle && songAuthor) ? `${songTitle} ${songAuthor}` : (songTitle || query);
            let candidates = [];

            // Strategy 1: Apple Music search with full query (primary source - works everywhere)
            const amResult = await node.rest.resolve(`amsearch:${audioQuery}`);
            const amLoadType = amResult?.loadType ? amResult.loadType.toLowerCase() : '';
            if (amLoadType !== 'empty' && amLoadType !== 'error' && amResult && amResult.data) {
                const amTracks = (Array.isArray(amResult.data) ? amResult.data : (amResult.data.tracks || []))
                    .filter(t => t && t.info && t.info.title);
                candidates.push(...amTracks.slice(0, 10));
                console.log(`[Search] Apple Music found ${amTracks.length} candidates`);
            }

            // Strategy 2: If we have separate title/author, also try just the title on Apple Music
            if (songTitle && songAuthor && candidates.length < 5) {
                const amResult2 = await node.rest.resolve(`amsearch:${songTitle}`);
                const amLoadType2 = amResult2?.loadType ? amResult2.loadType.toLowerCase() : '';
                if (amLoadType2 !== 'empty' && amLoadType2 !== 'error' && amResult2 && amResult2.data) {
                    const amTracks2 = (Array.isArray(amResult2.data) ? amResult2.data : (amResult2.data.tracks || []))
                        .filter(t => t && t.info && t.info.title);
                    candidates.push(...amTracks2.slice(0, 5));
                }
            }

            // Strategy 3: YouTube search ONLY for premium guilds where other sources failed
            if (candidates.length === 0 && isPremium && !interaction.client.youtubeDisabled) {
                try {
                    const ytResult = await node.rest.resolve(`ytsearch:${audioQuery}`);
                    const ytLoadType = ytResult?.loadType ? ytResult.loadType.toLowerCase() : '';
                    if (ytLoadType !== 'empty' && ytLoadType !== 'error' && ytResult && ytResult.data) {
                        const ytTracks = (Array.isArray(ytResult.data) ? ytResult.data : (ytResult.data.tracks || []))
                            .filter(t => t && t.info && t.info.title);
                        candidates.push(...ytTracks.slice(0, 5));
                        console.log(`[Search] YouTube fallback found ${ytTracks.length} candidates`);
                    }
                } catch (e) {
                    console.warn('[Search] YouTube fallback failed:', e.message);
                }
            }

            if (candidates.length > 0) {
                // Score and rank all candidates
                const scored = candidates
                    .filter(t => !isRemixOrLive(t.info.title, query))
                    .map(t => {
                        // Score by title match
                        const titleScore = matchScore(t.info.title, songTitle || query);
                        // Bonus for matching artist
                        const artistScore = songAuthor ? matchScore(t.info.author, songAuthor) : 0;
                        // Combined score (title matters more)
                        const total = (titleScore * 0.7) + (artistScore * 0.3);
                        return { track: t, score: total };
                    })
                    .sort((a, b) => b.score - a.score);

                if (scored.length > 0 && scored[0].score >= 0.3) {
                    searchResult = { loadType: 'track', data: scored[0].track };
                    console.log(`[Search] Best match: "${scored[0].track.info.title}" by ${scored[0].track.info.author} (score: ${scored[0].score.toFixed(2)}, source: ${scored[0].track.info.sourceName})`);
                } else {
                    // Low confidence - take the first result anyway
                    const fallback = candidates[0];
                    searchResult = { loadType: 'track', data: fallback };
                    console.log(`[Search] Low confidence fallback: "${fallback.info.title}" by ${fallback.info.author} (source: ${fallback.info.sourceName})`);
                }
            }
        }

        if (!searchResult) return interaction.editReply('No results found on safe platforms.');

        let track = searchResult.data;
        if (!track) return interaction.editReply('Could not parse track data.');

        // 2. QUEUE HANDLING
        const isPlaylist = searchResult.loadType === 'playlist' && searchResult.allTracks;
        const allTracks = isPlaylist ? searchResult.allTracks : [track];

        const queue = interaction.client.queue.get(interaction.guild.id);
        if (queue) {
            const wasEmpty = queue.songs.length === 0;

            // Add all tracks to existing queue
            for (const t of allTracks) {
                queue.songs.push(t);
                // Record in history for autoplay dedup
                await historyTracker.addPlayed(interaction.guild.id, t);
            }

            if (wasEmpty) {
                // If the queue was empty, the player is currently sitting idle (e.g. autoplay ran out of songs).
                // We must explicitly start playing the newly added track.
                await queue.player.playTrack({ encodedTrack: queue.songs[0].encoded });
            }

            const embed = new EmbedBuilder().setColor('Red').setDescription(
                isPlaylist
                    ? `📝 Added **${allTracks.length} songs** from **${searchResult.playlistName}** to the queue!`
                    : `📝 Added to queue: **${track.info.title}**`
            );
            return interaction.editReply({ content: '', embeds: [embed] });
        }

        // 3. NEW PLAYER
        try {
            let player = interaction.client.shoukaku.players.get(interaction.guild.id);
            
            // Check if player exists but the bot is physically not in any voice channel
            if (player && !interaction.guild.members.me.voice?.channelId) {
                try { await interaction.client.shoukaku.leaveVoiceChannel(interaction.guild.id); } catch(e) {}
                player = null;
            }

            if (!player) {
                player = await interaction.client.shoukaku.joinVoiceChannel({
                    guildId: interaction.guild.id,
                    channelId: channel.id,
                    shardId: interaction.guild.shardId,
                    deaf: true
                });
            }

            await attachPlayerEvents(player, interaction, guildId, isPremium, node);

            // Record seed track in history
            await historyTracker.addPlayed(interaction.guild.id, track);

            const newQueue = {
                player,
                songs: [track],
                textChannel: interaction.channel,
                autoplay: false,
                loop: 'off',
                twentyFourSeven: false,
                lastMessage: null
            };

            // If playlist, add remaining tracks to the new queue
            if (isPlaylist && allTracks.length > 1) {
                for (let i = 1; i < allTracks.length; i++) {
                    newQueue.songs.push(allTracks[i]);
                    await historyTracker.addPlayed(interaction.guild.id, allTracks[i]);
                }
            }

            interaction.client.queue.set(interaction.guild.id, newQueue);

            // Clean up the initial command reply
            await interaction.deleteReply().catch(() => { });

            await player.playTrack({ encodedTrack: track.encoded });

        } catch (error) {
            console.error(error);
            return interaction.editReply('Failed.');
        }
    }
}
