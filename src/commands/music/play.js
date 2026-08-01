const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } = require('discord.js');
const YouTube = require('youtube-sr').default;
const premiumService = require('../../services/premiumService');
const { handleAutoplay, getBaseSignature } = require('../../utils/autoplay');

// Per-guild exception cooldown to prevent message spam
// Map<guildId, { lastSentAt: number, consecutiveFails: number }>
const exceptionState = new Map();

// ---------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------

function cleanTitle(title) {
    return title
        .replace(/\(Official\s*(Video|Audio|Music Video|Visualizer|Lyric Video)?\)/gi, '')
        .replace(/\(Lyrics?\)/gi, '')
        .replace(/\(Lyric Video\)/gi, '')
        .replace(/\(Audio\)/gi, '')
        .replace(/\(Visualizer\)/gi, '')
        .replace(/\(4K\)/gi, '')
        .replace(/\(HD\)/gi, '')
        .replace(/\(Explicit\)/gi, '')
        .replace(/\(Clean\)/gi, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\|.*$/g, '') // Remove everything after pipe
        .replace(/ft\.?\s+.*/gi, '') // Remove featuring info
        .replace(/feat\.?\s+.*/gi, '')
        .replace(/prod\.?\s+.*/gi, '') // Remove producer info
        .replace(/\s*-\s*Topic$/gi, '') // Remove YouTube "Topic" channels
        .replace(/VEVO$/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRemixOrLive(title, originalQuery) {
    const lowerTitle = title.toLowerCase();
    const lowerQuery = originalQuery.toLowerCase();
    const unwanted = ['remix', 'mix', 'live', 'cover', 'edit', 'club', 'extended', 'instrumental', 'karaoke', 'slowed', 'reverb', 'sped up', 'nightcore', 'bass boosted'];

    for (const word of unwanted) {
        if (lowerTitle.includes(word) && !lowerQuery.includes(word)) {
            return true;
        }
    }
    return false;
}

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

function isFuzzyMatch(str1, str2) {
    return matchScore(str1, str2) >= 0.4;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function shuffleQueue(queue) {
    if (queue.songs.length <= 2) return;
    for (let i = queue.songs.length - 1; i > 1; i--) {
        const j = 1 + Math.floor(Math.random() * (i));
        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }
}

// ---------------------------------------------------------
// AUTOPLAY ENGINE - YouTube Mix (Replaced V6)
// ---------------------------------------------------------
// Logic moved to utils/autoplay.js

// ---------------------------------------------------------
// COMPONENT COLLECTOR
// ---------------------------------------------------------

async function setupCollector(message, player, queue, interaction, guildId) {
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 0
    });

    collector.on('collect', async (i) => {
        if (!queue.player) return i.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

        if (!i.member.voice.channelId || i.member.voice.channelId !== interaction.guild.members.me.voice.channelId) {
            return i.reply({ content: 'You need to be in the voice channel to control the music!', flags: MessageFlags.Ephemeral });
        }

        try {
            await i.deferUpdate();

            switch (i.customId) {
                // ROW 1
                case 'skip':
                    player.stopTrack();
                    break;
                case 'stop':
                    queue.isIntentionalLeave = true;
                    interaction.client.queue.delete(guildId);
                    player.stopTrack();
                    await interaction.client.shoukaku.leaveVoiceChannel(guildId);
                    const disabledRows = i.message.components.map(row => {
                        const r = ActionRowBuilder.from(row);
                        r.components.forEach(c => c.setDisabled(true));
                        return r;
                    });
                    await i.editReply({ components: disabledRows });
                    break;
                case 'pause':
                    const isPaused = player.paused;
                    player.setPaused(!isPaused);
                    queue.paused = !isPaused; // Track state
                    // Update button after toggle
                    const updatedButtons = createControlButtons(queue);
                    await i.message.edit({ components: updatedButtons });
                    break;
                case 'autoplay':
                    queue.autoplay = !queue.autoplay;
                    await i.editReply({ components: createControlButtons(queue) });
                    break;
                case 'shuffle':
                    shuffleQueue(queue);
                    await i.followUp({ content: '🔀 Queue shuffled!', flags: MessageFlags.Ephemeral });
                    break;

                // ROW 2
                case 'loop_song':
                    queue.loop = (queue.loop === 'track') ? 'off' : 'track';
                    await i.editReply({ components: createControlButtons(queue) });
                    break;
                case 'loop_queue':
                    queue.loop = (queue.loop === 'queue') ? 'off' : 'queue';
                    await i.editReply({ components: createControlButtons(queue) });
                    break;
                case 'forward':
                    {
                        const currentPos = player.position;
                        const newPos = currentPos + 10000;
                        if (newPos < queue.songs[0].info.length) player.seekTo(newPos);
                    }
                    break;
                case 'rewind':
                    {
                        const currentPos = player.position;
                        const newPos = Math.max(0, currentPos - 10000);
                        player.seekTo(newPos);
                    }
                    break;
                case 'save':
                    try {
                        const track = queue.songs[0];
                        const embed = new EmbedBuilder()
                            .setColor('Green')
                            .setTitle('💾 Saved Song')
                            .setDescription(`You saved **[${track.info.title}](${track.info.uri || ''})**`)
                            .addFields(
                                { name: 'Artist', value: track.info.author, inline: true },
                                { name: 'Source', value: track.info.sourceName, inline: true }
                            )
                            .setFooter({ text: `Saved from ${interaction.guild.name}` });
                        if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

                        await i.user.send({ embeds: [embed] });
                        await i.followUp({ content: 'I have sent the song to your DMs!', flags: MessageFlags.Ephemeral });
                    } catch (e) {
                        await i.followUp({ content: 'Could not DM you. Check privacy settings.', flags: MessageFlags.Ephemeral });
                    }
                    break;
            }
        } catch (error) {
            console.error('Collector Error:', error);
        }
    });
}

function createControlButtons(queue) {
    const isAutoplay = queue.autoplay;
    const loopMode = queue.loop || 'off';
    const isPaused = queue.paused || false;

    const row1 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stop').setLabel('Stop').setEmoji('🏠').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('pause').setLabel(isPaused ? 'Resume' : 'Pause').setEmoji(isPaused ? '▶️' : '⏸️').setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('autoplay').setLabel('Autoplay').setEmoji('🔁').setStyle(isAutoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('shuffle').setLabel('Shuffle').setEmoji('🔀').setStyle(ButtonStyle.Primary)
        );

    const row2 = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('loop_song').setLabel('Song').setEmoji('🔂').setStyle(loopMode === 'track' ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('loop_queue').setLabel('Queue').setEmoji('🔁').setStyle(loopMode === 'queue' ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('forward').setLabel('+10 Sec').setEmoji('⏩').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('rewind').setLabel('-10 Sec').setEmoji('⏪').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('save').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Secondary)
        );

    return [row1, row2];
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
                // Text query: try Apple Music -> Deezer -> Tidal -> SoundCloud -> YouTube (minimize YouTube)
                const strategies = [
                    { name: 'Apple Music', prefix: 'amsearch:' },
                    { name: 'Deezer', prefix: 'dzsearch:' },
                    { name: 'Tidal', prefix: 'tidalSearch:' },
                    { name: 'SoundCloud', prefix: 'scsearch:' },
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

            // Strategy 3: SoundCloud search as fallback
            if (candidates.length < 5) {
                try {
                    const scResult = await node.rest.resolve(`scsearch:${audioQuery}`);
                    const scLoadType = scResult?.loadType ? scResult.loadType.toLowerCase() : '';
                    if (scLoadType !== 'empty' && scLoadType !== 'error' && scResult && scResult.data) {
                        const scTracks = (Array.isArray(scResult.data) ? scResult.data : (scResult.data.tracks || []))
                            .filter(t => t && t.info && t.info.title);
                        candidates.push(...scTracks.slice(0, 5));
                        console.log(`[Search] SoundCloud found ${scTracks.length} candidates`);
                    }
                } catch (e) {
                    console.warn('[Search] SoundCloud search failed:', e.message);
                }
            }

            // Strategy 4: YouTube search ONLY for premium guilds where other sources failed
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
            // Add all tracks to existing queue
            for (const t of allTracks) {
                queue.songs.push(t);
                if (queue.previousTracks) queue.previousTracks.add(`${t.info.author} - ${t.info.title}`.toLowerCase());
                if (!queue.seedTracks) queue.seedTracks = [];
                queue.seedTracks.push(t);
                if (queue.seedTracks.length > 10) queue.seedTracks.shift();
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

            // --- PLAYER EVENT: START ---
            player.on('start', async (data) => {
                const currentQueue = interaction.client.queue.get(guildId);
                if (!currentQueue || !currentQueue.songs[0]) return;
                const currentTrack = currentQueue.songs[0];

                // A track started successfully — reset the exception failure counter
                exceptionState.delete(guildId);

                if (currentQueue.lastMessage) {
                    try { await currentQueue.lastMessage.delete(); } catch (e) { }
                }

                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setAuthor({
                        name: 'Now Playing',
                        iconURL: 'https://media.tenor.com/I5kylHJduP4AAAAj/disc-spinning.gif'
                    })
                    .setDescription(`**[${currentTrack.info.title}](${currentTrack.info.uri || ''})**\n\n**Artist**: ${currentTrack.info.author}\n**Source**: ${currentTrack.info.sourceName}`)
                    .addFields(
                        { name: 'Duration', value: formatDuration(currentTrack.info.length), inline: true },
                        { name: 'Requested By', value: `<@${interaction.user.id}>`, inline: true }
                    )
                    .setFooter({ text: isPremium ? 'Premium Mode • Direct Source Access' : 'Safe Mode • Apple Music Priority • Anti-Remix' });

                if (currentTrack.info.artworkUrl) embed.setThumbnail(currentTrack.info.artworkUrl);

                const buttons = createControlButtons(currentQueue);

                const channel = currentQueue.textChannel;
                const msg = await channel.send({ embeds: [embed], components: buttons });
                currentQueue.lastMessage = msg;

                setupCollector(msg, player, currentQueue, interaction, guildId);
            });

            player.on('end', async (data) => {
                const reason = (data.reason || '').toLowerCase();
                // Only process the queue progression if the track naturally finished or was explicitly stopped
                if (reason !== 'finished' && reason !== 'stopped') return;
                
                const currentQueue = interaction.client.queue.get(guildId);
                if (currentQueue && currentQueue.player) {
                    const finishedTrack = currentQueue.songs[0];
                    if (finishedTrack) {
                        const sig = getBaseSignature(finishedTrack.info.author, finishedTrack.info.title);
                        currentQueue.previousTracks.add(sig);

                        // Track as seed for autoplay recommendations
                        if (!currentQueue.seedTracks) currentQueue.seedTracks = [];
                        currentQueue.seedTracks.push(finishedTrack);
                        if (currentQueue.seedTracks.length > 10) currentQueue.seedTracks.shift(); // Keep last 10
                    }

                    // HANDLE LOOPING
                    if (currentQueue.loop === 'track') {
                        // Replay
                    } else if (currentQueue.loop === 'queue') {
                        currentQueue.songs.shift(); // Remove from front
                        currentQueue.songs.push(finishedTrack); // Add to back
                    } else {
                        currentQueue.songs.shift(); // Normal behavior
                    }

                    if (currentQueue.loop === 'track') {
                        const sameTrack = currentQueue.songs[0];
                        currentQueue.player.playTrack({ encodedTrack: sameTrack.encoded });
                    } else if (currentQueue.songs.length > 0) {
                        const nextTrack = currentQueue.songs[0];
                        currentQueue.player.playTrack({ encodedTrack: nextTrack.encoded });
                    } else if (currentQueue.autoplay && finishedTrack) {
                        // Don't double-trigger autoplay if the exception handler is currently
                        // running its async fallback search — it will emit 'stopped' itself
                        // once it's done, which will re-enter this handler cleanly.
                        if (currentQueue.isHandlingException) return;
                        console.log('[Autoplay] Queue empty. Finding next track (AM -> Deezer -> Tidal -> SC -> YT)...');
                        try {
                            const newTrack = await handleAutoplay(interaction.client, player, finishedTrack, currentQueue);
                            if (newTrack) {
                                console.log(`[Autoplay] Queued track: ${newTrack.info.title}`);
                                currentQueue.songs.push(newTrack);
                                currentQueue.player.playTrack({ encodedTrack: newTrack.encoded });
                                return;
                            }
                        } catch (e) { console.error('[Autoplay] Engine error:', e); }

                        console.log('[Autoplay] No valid candidates found.');
                        if (!currentQueue.twentyFourSeven) {
                            currentQueue.songs = [];
                            try {
                                await currentQueue.textChannel.send({ embeds: [new EmbedBuilder().setColor('Orange').setDescription('⚠️ Autoplay could not find any related songs. Use `/play` to add more tracks.')] });
                            } catch (e) {}
                        }
                    } else if (!currentQueue.twentyFourSeven) {
                        currentQueue.isIntentionalLeave = true;
                        await interaction.client.shoukaku.leaveVoiceChannel(guildId);
                    }
                }
            });

            player.on('closed', async (r) => {
                console.log(r);
                const closedQueue = interaction.client.queue.get(guildId);
                if (closedQueue) {
                    try {
                        if (closedQueue.lastMessage) {
                            try { await closedQueue.lastMessage.delete(); } catch (e) { }
                        }
                        if (!closedQueue.isIntentionalLeave) {
                            const dcEmbed = new EmbedBuilder()
                                .setColor('Red')
                                .setDescription('⚠️ I was disconnected from the voice channel. The queue has been cleared.');
                            await closedQueue.textChannel.send({ embeds: [dcEmbed] });
                        }
                    } catch (e) {
                        console.error('Failed to send disconnect message:', e);
                    }
                    interaction.client.queue.delete(guildId);
                }
            });
            player.on('exception', async d => {
                const q = interaction.client.queue.get(guildId);
                if (!q) return;

                // Prevent the 'end' handler from also triggering autoplay while we handle this
                q.isHandlingException = true;

                const now = Date.now();
                const COOLDOWN_MS = 5000; // Min 5s between exception messages per guild
                const MAX_CONSECUTIVE_FAILS = 6; // Raised to allow AM/SC fallbacks to cycle during YouTube outages

                // Retrieve or initialize exception state for this guild
                let state = exceptionState.get(guildId) || { lastSentAt: 0, consecutiveFails: 0 };
                state.consecutiveFails++;
                exceptionState.set(guildId, state);

                // If too many consecutive failures, give up and disconnect
                if (state.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
                    exceptionState.delete(guildId);
                    try {
                        if (q.lastMessage) { try { await q.lastMessage.delete(); } catch (e) {} }
                        await q.textChannel.send({
                            embeds: [new EmbedBuilder().setColor('Red')
                                .setDescription('⚠️ Multiple tracks failed to load. Stopping playback to avoid spam. Please try a different song or source.')]
                        });
                    } catch (e) {}
                    q.isHandlingException = false;
                    q.isIntentionalLeave = true;
                    await interaction.client.shoukaku.leaveVoiceChannel(guildId);
                    return;
                }

                // Determine if we should send Discord messages (cooldown logic)
                const shouldSendMessage = (now - state.lastSentAt >= COOLDOWN_MS);
                if (shouldSendMessage) {
                    state.lastSentAt = now;
                    exceptionState.set(guildId, state);
                }

                // Bulletproof error extraction
                let errMsg = '';
                if (d.exception && d.exception.message) errMsg = d.exception.message;
                else if (d.message) errMsg = d.message;
                else if (d.error) errMsg = d.error;
                else if (typeof d === 'string') errMsg = d;
                else errMsg = JSON.stringify(d);
                
                console.log(`[Exception Handler] Triggered! Extracted errMsg: "${errMsg}"`);

                let userMessage;
                let fallbackSucceeded = false;
                
                if (errMsg.includes('All clients failed to load the item') || errMsg.includes('Invalid status code') || errMsg.includes('This video requires login') || errMsg.includes('Something went wrong') || errMsg.includes('Sign in to confirm')) {
                    let fallbackMsg;
                    if (shouldSendMessage) {
                        try {
                            fallbackMsg = await q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Orange').setDescription('⚠️ Track failed to load. Attempting to fall back to alternative sources (Apple Music, Deezer, Tidal, SoundCloud, YouTube)...')] });
                        } catch (e) {}
                    }

                        // Attempt to fallback using the title and artist of the failed track
                        const failedTrack = q.songs[0];
                        const isYouTubeTrack = failedTrack?.info?.sourceName === 'youtube' || failedTrack?.info?.sourceName === 'youtube-music';

                        console.log(`[Exception Debug] failedTrack exists: ${!!failedTrack}`);
                        if (failedTrack) {
                            console.log(`[Exception Debug] failedTrack.info exists: ${!!failedTrack.info}`);
                            console.log(`[Exception Debug] failedTrack.isFallback: ${failedTrack.isFallback}`);
                        }

                        if (failedTrack && failedTrack.info && !failedTrack.isFallback) {
                            // Clean title to strip " | Official Video" and bracketed text
                            const cleanedTitle = cleanTitle(failedTrack.info.title || '');
                            // Clean author name: strip YouTube topic channel suffixes like " - Topic", "VEVO"
                            const cleanAuthor = (failedTrack.info.author || '')
                                .replace(/\s*-\s*Topic$/gi, '')
                                .replace(/VEVO$/gi, '')
                                .trim();
                            const fallbackQuery = `${cleanedTitle} ${cleanAuthor}`.trim();
                            const failedSource = failedTrack.info.sourceName || '';
                            const failedId = failedTrack.info.identifier || '';
                            console.log(`[Fallback] Searching for: "${fallbackQuery}" (original source: ${failedSource})`);
                            
                            let fallbackTrack = null;

                            // Helper: filter out the exact same track (same identifier) to avoid infinite loops
                            const isNotSameTrack = (t) => t.info.identifier !== failedId;

                            // 1. Try Apple Music first — but SKIP if the failed track was already from Apple Music
                            // (LavaSrc mirrors AM tracks through YouTube, so re-finding the same AM track = same failure)
                            if (failedSource !== 'applemusic') {
                                try {
                                    const amRes = await node.rest.resolve(`amsearch:${fallbackQuery}`);
                                    const rawAmData = amRes?.data || amRes?.tracks;
                                    if (rawAmData) {
                                        let tracks = Array.isArray(rawAmData) ? rawAmData : (rawAmData.tracks || []);
                                        tracks = tracks.filter(t => t && t.info && t.info.title && !isRemixOrLive(t.info.title, fallbackQuery) && isNotSameTrack(t));
                                        if (tracks.length > 0) fallbackTrack = tracks[0];
                                    }
                                } catch (amErr) {
                                    console.error('[Fallback] Apple Music failed:', amErr);
                                }
                            }

                            // 2. Try Deezer (direct stream — no YouTube dependency, great reliability)
                            if (!fallbackTrack && failedSource !== 'deezer') {
                                try {
                                    const dzRes = await node.rest.resolve(`dzsearch:${fallbackQuery}`);
                                    const rawDzData = dzRes?.data || dzRes?.tracks;
                                    if (rawDzData) {
                                        let tracks = Array.isArray(rawDzData) ? rawDzData : (rawDzData.tracks || []);
                                        tracks = tracks.filter(t => t && t.info && t.info.title && !isRemixOrLive(t.info.title, fallbackQuery) && isNotSameTrack(t));
                                        if (tracks.length > 0) fallbackTrack = tracks[0];
                                    }
                                } catch (dzErr) {
                                    console.error('[Fallback] Deezer failed:', dzErr);
                                }
                            }

                            // 3. Try Tidal (mirrors via YouTube, same caveat as Apple Music)
                            if (!fallbackTrack && failedSource !== 'tidal') {
                                try {
                                    const tidalRes = await node.rest.resolve(`tidalSearch:${fallbackQuery}`);
                                    const rawTidalData = tidalRes?.data || tidalRes?.tracks;
                                    if (rawTidalData) {
                                        let tracks = Array.isArray(rawTidalData) ? rawTidalData : (rawTidalData.tracks || []);
                                        tracks = tracks.filter(t => t && t.info && t.info.title && !isRemixOrLive(t.info.title, fallbackQuery) && isNotSameTrack(t));
                                        if (tracks.length > 0) fallbackTrack = tracks[0];
                                    }
                                } catch (tidalErr) {
                                    console.error('[Fallback] Tidal failed:', tidalErr);
                                }
                            }

                            // 4. Try SoundCloud (streams directly, doesn't mirror through YouTube)
                            if (!fallbackTrack) {
                                try {
                                    const scRes = await node.rest.resolve(`scsearch:${fallbackQuery}`);
                                    const rawScData = scRes?.data || scRes?.tracks;
                                    if (rawScData) {
                                        let tracks = Array.isArray(rawScData) ? rawScData : (rawScData.tracks || []);
                                        tracks = tracks.filter(t => t && t.info && t.info.title && !isRemixOrLive(t.info.title, fallbackQuery) && isNotSameTrack(t));
                                        if (tracks.length > 0) fallbackTrack = tracks[0];
                                    }
                                } catch (scErr) {
                                    console.error('[Fallback] SoundCloud failed:', scErr);
                                }
                            }

                            // 5. Try YouTube as absolute last resort (premium only, and ONLY if original track was NOT YouTube)
                            // No point searching YouTube if the failure was caused by a YouTube block
                            if (!fallbackTrack && isPremium && !interaction.client.youtubeDisabled && !isYouTubeTrack) {
                                try {
                                    const ytRes = await node.rest.resolve(`ytsearch:${fallbackQuery}`);
                                    const rawYtData = ytRes?.data || ytRes?.tracks;
                                    if (rawYtData) {
                                        let tracks = Array.isArray(rawYtData) ? rawYtData : (rawYtData.tracks || []);
                                        tracks = tracks.filter(t => t && t.info && t.info.title && !isRemixOrLive(t.info.title, fallbackQuery) && isNotSameTrack(t));
                                        if (tracks.length > 0) fallbackTrack = tracks[0];
                                    }
                                } catch (ytErr) {
                                    console.error('[Fallback] YouTube failed:', ytErr);
                                }
                            }


                            if (fallbackTrack) {
                                fallbackTrack.isFallback = true;
                                q.songs[0] = fallbackTrack;
                                q.player.playTrack({ encodedTrack: fallbackTrack.encoded });
                                if (fallbackMsg) {
                                    fallbackMsg.edit({ embeds: [new EmbedBuilder().setColor('Green').setDescription(`✅ Successfully found a fallback track on **${fallbackTrack.info.sourceName}**!`)] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 5000)).catch(()=>{});
                                } else if (shouldSendMessage) {
                                    q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Green').setDescription(`✅ Successfully found a fallback track on **${fallbackTrack.info.sourceName}**!`)] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 5000)).catch(()=>{});
                                }
                                // Reset consecutive fail counter since we recovered successfully
                                state.consecutiveFails = 0;
                                exceptionState.set(guildId, state);
                                fallbackSucceeded = true; // Prevent the skip emit below
                            }
                        }

                        if (!fallbackSucceeded) {
                            if (fallbackMsg) {
                                fallbackMsg.edit({ embeds: [new EmbedBuilder().setColor('Red').setDescription('❌ All fallback sources (Apple Music, Deezer, Tidal, SoundCloud, YouTube) failed. Skipping to the next song.')] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 7000)).catch(()=>{});
                            } else if (shouldSendMessage) {
                                q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Red').setDescription('❌ All fallback sources (Apple Music, Deezer, Tidal, SoundCloud, YouTube) failed. Skipping to the next song.')] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 7000)).catch(()=>{});
                            }
                            // Skip to the next track since all fallbacks failed
                            q.isHandlingException = false;
                            q.player.emit('end', { reason: 'stopped' });
                        } else {
                            q.isHandlingException = false;
                        }
                    } else {
                        userMessage = `⚠️ Error: ${errMsg}`;
                        if (shouldSendMessage) {
                            try {
                                const errMsgObj = await q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Red').setDescription(userMessage)] });
                                setTimeout(() => {
                                    if (errMsgObj) errMsgObj.delete().catch(() => {});
                                }, 5000);
                            } catch (e) {}
                        }
                        // Skip to the next track
                        q.isHandlingException = false;
                        q.player.emit('end', { reason: 'stopped' });
                    }
                // (End of exception handler block)
            });

            const newQueue = {
                player,
                songs: [track],
                textChannel: interaction.channel,
                autoplay: false,
                loop: 'off',
                twentyFourSeven: false,
                previousTracks: new Set([`${track.info.author} - ${track.info.title}`.toLowerCase()]),
                seedTracks: [track], // Seed history for autoplay recommendations
                lastMessage: null
            };

            // If playlist, add remaining tracks to the new queue
            if (isPlaylist && allTracks.length > 1) {
                for (let i = 1; i < allTracks.length; i++) {
                    newQueue.songs.push(allTracks[i]);
                    newQueue.previousTracks.add(`${allTracks[i].info.author} - ${allTracks[i].info.title}`.toLowerCase());
                    newQueue.seedTracks.push(allTracks[i]);
                    if (newQueue.seedTracks.length > 10) newQueue.seedTracks.shift();
                }
            }

            interaction.client.queue.set(interaction.guild.id, newQueue);

            // Clean up the initial command reply
            await interaction.editReply({ content: '', embeds: [], components: [] }).catch(() => { });

            await player.playTrack({ encodedTrack: track.encoded });

        } catch (error) {
            console.error(error);
            return interaction.editReply('Failed.');
        }
    }
}
