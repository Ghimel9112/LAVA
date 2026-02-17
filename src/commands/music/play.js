const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType, MessageFlags } = require('discord.js');
const ytdl = require('@distube/ytdl-core');
const db = require('../../utils/db');
const handleAutoplay = require('../../utils/autoplay');

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

async function setupCollector(message, player, queue, interaction) {
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
                    player.setPaused(true);
                    interaction.client.shoukaku.leaveVoiceChannel(interaction.guild.id);
                    interaction.client.queue.delete(interaction.guild.id);
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

        const { channel } = interaction.member.voice;
        if (!channel) return interaction.editReply('You need to be in a voice channel to play music!');

        const permissions = channel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.editReply('I need the **Connect** and **Speak** permissions in that voice channel!');
        }

        let query = interaction.options.getString('query');
        const node = interaction.client.shoukaku.getIdealNode();
        if (!node) return interaction.editReply('No Lavalink node is available.');

        // 1. RESOLVE SEARCH
        let searchResult;
        const isPremium = db.isPremium(interaction.guild.id);
        console.log(`[DEBUG] Guild: ${interaction.guild.id}, Premium: ${isPremium}, Query: ${query}`);

        if (isPremium) {
            // premium: try direct resolution first
            const res = await node.rest.resolve(query);
            console.log(`[DEBUG] Premium Direct Resolve: type=${res?.loadType}, dataIsArray=${Array.isArray(res?.data)}`);

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
                } else if (loadType === 'search' || loadType === 'search_result') {
                    // SEARCH: take first result only
                    let tracks = [];
                    if (Array.isArray(rawData)) {
                        tracks = rawData;
                    } else if (rawData.tracks && Array.isArray(rawData.tracks)) {
                        tracks = rawData.tracks;
                    }

                    if (tracks && tracks.length > 0) {
                        searchResult = { loadType: 'track', data: tracks[0] };
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

            // Fallback for text search if direct resolve failed
            if (!searchResult && !/^https?:\/\//.test(query)) {
                const ytRes = await node.rest.resolve(`ytsearch:${query}`);
                if (ytRes?.data) {
                    const tracks = Array.isArray(ytRes.data) ? ytRes.data : (ytRes.data.tracks || []);
                    if (tracks.length > 0) {
                        searchResult = { loadType: 'track', data: tracks[0] };
                    }
                }
            }
        }

        // If not premium OR if premium search failed,
        // Fallback to Safe Mode
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

        // Safe Mode single-track search (non-playlist)
        if (!searchResult) {
            let songTitle = '', songAuthor = '';
            if (ytdl.validateURL(query)) {
                try {
                    const info = await ytdl.getBasicInfo(query);
                    songTitle = cleanTitle(info.videoDetails.title);
                    songAuthor = info.videoDetails.author.name.replace(/\s*-\s*Topic$/gi, '').replace(/VEVO$/gi, '').trim();
                } catch (error) { }
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

            const audioQuery = (songTitle && songAuthor) ? `${songTitle} ${songAuthor}` : query;
            let candidates = [];

            // Strategy 1: Spotify search with full query
            const spResult = await node.rest.resolve(`spsearch:${audioQuery}`);
            if (spResult && spResult.data) {
                const spTracks = (Array.isArray(spResult.data) ? spResult.data : [spResult.data])
                    .filter(t => t && t.info && t.info.title);
                candidates.push(...spTracks.slice(0, 10));
            }

            // Strategy 2: If we have separate title/author, also try just the title
            if (songTitle && songAuthor && candidates.length < 5) {
                const spResult2 = await node.rest.resolve(`spsearch:${songTitle}`);
                if (spResult2 && spResult2.data) {
                    const spTracks2 = (Array.isArray(spResult2.data) ? spResult2.data : [spResult2.data])
                        .filter(t => t && t.info && t.info.title);
                    candidates.push(...spTracks2.slice(0, 5));
                }
            }

            // Strategy 3: Fallback SoundCloud if Spotify gave nothing
            if (candidates.length === 0) {
                const scResult = await node.rest.resolve(`scsearch:${audioQuery}`);
                if (scResult && scResult.data) {
                    const scTracks = (Array.isArray(scResult.data) ? scResult.data : [scResult.data])
                        .filter(t => t && t.info && t.info.title);
                    candidates.push(...scTracks.slice(0, 10));
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
                    console.log(`[Search] Best match: "${scored[0].track.info.title}" by ${scored[0].track.info.author} (score: ${scored[0].score.toFixed(2)})`);
                } else {
                    // Low confidence - take the first Spotify result anyway
                    const fallback = candidates[0];
                    searchResult = { loadType: 'track', data: fallback };
                    console.log(`[Search] Low confidence fallback: "${fallback.info.title}" by ${fallback.info.author}`);
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
                const currentQueue = interaction.client.queue.get(interaction.guild.id);
                if (!currentQueue || !currentQueue.songs[0]) return;
                const currentTrack = currentQueue.songs[0];

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
                    .setFooter({ text: isPremium ? 'Premium Mode • Direct Source Access' : 'Safe Mode • Spotify Priority • Anti-Remix' });

                if (currentTrack.info.artworkUrl) embed.setThumbnail(currentTrack.info.artworkUrl);

                const buttons = createControlButtons(currentQueue);

                const channel = currentQueue.textChannel;
                const msg = await channel.send({ embeds: [embed], components: buttons });
                currentQueue.lastMessage = msg;

                setupCollector(msg, player, currentQueue, interaction);
            });

            player.on('end', async (data) => {
                const currentQueue = interaction.client.queue.get(interaction.guild.id);
                if (currentQueue && currentQueue.player) {
                    const finishedTrack = currentQueue.songs[0];
                    if (finishedTrack) {
                        const sig = `${finishedTrack.info.author} - ${finishedTrack.info.title}`.toLowerCase();
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
                        console.log('[Autoplay] Queue empty. Starting YouTube Mix...');
                        try {
                            const newTrack = await handleAutoplay(interaction.client, player, finishedTrack, currentQueue);
                            if (newTrack) {
                                console.log(`[Autoplay] Queued track: ${newTrack.info.title}`);
                                currentQueue.player.playTrack({ encodedTrack: newTrack.encoded });
                                return;
                            }
                        } catch (e) { console.error('[Autoplay] Engine error:', e); }

                        console.log('[Autoplay] No valid candidates found.');
                        if (!currentQueue.twentyFourSeven) {
                            interaction.client.shoukaku.leaveVoiceChannel(interaction.guild.id);
                            interaction.client.queue.delete(interaction.guild.id);
                        }
                    } else if (!currentQueue.twentyFourSeven) {
                        interaction.client.shoukaku.leaveVoiceChannel(interaction.guild.id);
                        interaction.client.queue.delete(interaction.guild.id);
                    }
                }
            });

            player.on('closed', async (r) => {
                console.log(r);
                const closedQueue = interaction.client.queue.get(interaction.guild.id);
                if (closedQueue) {
                    try {
                        if (closedQueue.lastMessage) {
                            try { await closedQueue.lastMessage.delete(); } catch (e) { }
                        }
                        const dcEmbed = new EmbedBuilder()
                            .setColor('Red')
                            .setDescription('⚠️ I was disconnected from the voice channel. The queue has been cleared.');
                        await closedQueue.textChannel.send({ embeds: [dcEmbed] });
                    } catch (e) {
                        console.error('Failed to send disconnect message:', e);
                    }
                    interaction.client.queue.delete(interaction.guild.id);
                }
            });
            player.on('exception', d => {
                const q = interaction.client.queue.get(interaction.guild.id);
                if (q) {
                    q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Red').setDescription(`Error: ${d.exception.message}`)] });
                    // Just stop the track. This triggers 'end' event, which handles queue shift & autoplay.
                    q.player.stopTrack();
                }
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
            await interaction.deleteReply().catch(() => { });

            await player.playTrack({ encodedTrack: track.encoded });

        } catch (error) {
            console.error(error);
            return interaction.editReply('Failed.');
        }
    }
}
