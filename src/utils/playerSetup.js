const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { handleAutoplay } = require('./autoplay');
const historyTracker = require('../services/autoplay/historyTracker');

const exceptionState = new Map();
const COOLDOWN_MS = 5000;
const MAX_CONSECUTIVE_FAILS = 6;

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
        .replace(/\|.*$/g, '')
        .replace(/ft\.?\s+.*/gi, '')
        .replace(/feat\.?\s+.*/gi, '')
        .replace(/prod\.?\s+.*/gi, '')
        .replace(/\s*-\s*Topic$/gi, '')
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

function setupCollector(message, player, queue, interaction, guildId) {
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
                    queue.paused = !isPaused;
                    const updatedButtons = createControlButtons(queue);
                    await i.message.edit({ components: updatedButtons });
                    break;
                case 'autoplay':
                    queue.autoplay = !queue.autoplay;
                    await i.editReply({ components: createControlButtons(queue) });
                    
                    // If autoplay was just enabled, and the queue is completely idle (0 or 1 track playing),
                    // preload the next track immediately.
                    if (queue.autoplay && queue.songs.length <= 1) {
                        // Use the currently playing track, or the last track in history if completely idle
                        let seedTrack = queue.songs[0];
                        if (!seedTrack) {
                            const played = await historyTracker.getPlayed(guildId);
                            seedTrack = played[0];
                        }
                        
                        if (seedTrack && !queue.isHandlingException) {
                            queue.isHandlingException = true;
                            try {
                                const newTrack = await handleAutoplay(interaction.client, player, seedTrack, queue);
                                if (newTrack) {
                                    queue.songs.push(newTrack);
                                    // If nothing was playing, start it instantly
                                    if (queue.songs.length === 1) {
                                        queue.player.playTrack({ encodedTrack: newTrack.encoded });
                                    } else {
                                        const embed = new EmbedBuilder().setColor('Green').setDescription(`🔮 Autoplay queued: **${newTrack.info.title}**`);
                                        await i.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
                                    }
                                }
                            } catch (e) {
                                console.error('[Autoplay] Preload error:', e);
                            } finally {
                                queue.isHandlingException = false;
                            }
                        }
                    }
                    break;
                case 'shuffle':
                    if (queue.songs.length > 2) {
                        for (let idx = queue.songs.length - 1; idx > 1; idx--) {
                            const j = 1 + Math.floor(Math.random() * idx);
                            [queue.songs[idx], queue.songs[j]] = [queue.songs[j], queue.songs[idx]];
                        }
                    }
                    await i.followUp({ content: '🔀 Queue shuffled!', flags: MessageFlags.Ephemeral });
                    break;
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

async function attachPlayerEvents(player, interaction, guildId, isPremium, node) {
    if (player._eventsAttached) return;
    player._eventsAttached = true;

    player.on('start', async (data) => {
        const currentQueue = interaction.client.queue.get(guildId);
        if (!currentQueue || !currentQueue.songs[0]) return;
        const currentTrack = currentQueue.songs[0];

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
        if (reason !== 'finished' && reason !== 'stopped') return;

        const currentQueue = interaction.client.queue.get(guildId);
        if (currentQueue && currentQueue.player) {
            const finishedTrack = currentQueue.songs[0];
            if (finishedTrack) {
                // Record the finished track in history
                // This replaces the old Set-based previousTracks approach
                await historyTracker.addPlayed(guildId, finishedTrack);
            }

            if (currentQueue.loop === 'track') {
                // Replay
            } else if (currentQueue.loop === 'queue') {
                currentQueue.songs.shift();
                currentQueue.songs.push(finishedTrack);
            } else {
                currentQueue.songs.shift();
            }

            if (currentQueue.loop === 'track') {
                const sameTrack = currentQueue.songs[0];
                currentQueue.player.playTrack({ encodedTrack: sameTrack.encoded });
            } else if (currentQueue.songs.length > 0) {
                const nextTrack = currentQueue.songs[0];
                currentQueue.player.playTrack({ encodedTrack: nextTrack.encoded });
            } else if (currentQueue.autoplay && finishedTrack) {
                if (currentQueue.isHandlingException) return;
                console.log('[Autoplay] Queue empty. Finding next track...');
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
            
            // Clear autoplay history so the next session starts fresh
            try { await historyTracker.clearHistory(guildId); } catch(e) { console.error('Failed to clear history:', e); }
            
            interaction.client.queue.delete(guildId);
        }
    });

    player.on('exception', async d => {
        const q = interaction.client.queue.get(guildId);
        if (!q) return;

        q.isHandlingException = true;

        const now = Date.now();

        let state = exceptionState.get(guildId) || { lastSentAt: 0, consecutiveFails: 0 };
        state.consecutiveFails++;
        exceptionState.set(guildId, state);

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

        const shouldSendMessage = (now - state.lastSentAt >= COOLDOWN_MS);
        if (shouldSendMessage) {
            state.lastSentAt = now;
            exceptionState.set(guildId, state);
        }

        let errMsg = '';
        if (d.exception && d.exception.message) errMsg = d.exception.message;
        else if (d.message) errMsg = d.message;
        else if (d.error) errMsg = d.error;
        else if (typeof d === 'string') errMsg = d;
        else errMsg = JSON.stringify(d);

        console.log(`[Exception Handler] Triggered! Extracted errMsg: "${errMsg}"`);

        let fallbackSucceeded = false;

        if (errMsg.includes('All clients failed to load the item') || errMsg.includes('Invalid status code') || errMsg.includes('This video requires login') || errMsg.includes('Something went wrong') || errMsg.includes('Sign in to confirm')) {
            let fallbackMsg;
            if (shouldSendMessage) {
                try {
                    fallbackMsg = await q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Orange').setDescription('⚠️ Track failed to load. Attempting to fall back to alternative sources...')] });
                } catch (e) {}
            }

            const failedTrack = q.songs[0];
            const isYouTubeTrack = failedTrack?.info?.sourceName === 'youtube' || failedTrack?.info?.sourceName === 'youtube-music';

            if (failedTrack && failedTrack.info && !failedTrack.isFallback) {
                const cleanedTitle = cleanTitle(failedTrack.info.title || '');
                const cleanAuthor = (failedTrack.info.author || '')
                    .replace(/\s*-\s*Topic$/gi, '')
                    .replace(/VEVO$/gi, '')
                    .trim();
                const fallbackQuery = `${cleanedTitle} ${cleanAuthor}`.trim();
                const failedSource = failedTrack.info.sourceName || '';
                const failedId = failedTrack.info.identifier || '';
                console.log(`[Fallback] Searching for: "${fallbackQuery}" (original source: ${failedSource})`);

                let fallbackTrack = null;
                const isNotSameTrack = (t) => t.info.identifier !== failedId;

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
                    state.consecutiveFails = 0;
                    exceptionState.set(guildId, state);
                    fallbackSucceeded = true;
                }
            }

            if (!fallbackSucceeded) {
                if (fallbackMsg) {
                    fallbackMsg.edit({ embeds: [new EmbedBuilder().setColor('Red').setDescription('❌ All fallback sources failed. Skipping to the next song.')] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 7000)).catch(()=>{});
                } else if (shouldSendMessage) {
                    q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Red').setDescription('❌ All fallback sources failed. Skipping to the next song.')] }).then(m => setTimeout(()=>m.delete().catch(()=>{}), 7000)).catch(()=>{});
                }
                q.isHandlingException = false;
                q.player.emit('end', { reason: 'stopped' });
            } else {
                q.isHandlingException = false;
            }
        } else {
            const userMessage = `⚠️ Error: ${errMsg}`;
            if (shouldSendMessage) {
                try {
                    const errMsgObj = await q.textChannel.send({ embeds: [new EmbedBuilder().setColor('Red').setDescription(userMessage)] });
                    setTimeout(() => {
                        if (errMsgObj) errMsgObj.delete().catch(() => {});
                    }, 5000);
                } catch (e) {}
            }
            q.isHandlingException = false;
            q.player.emit('end', { reason: 'stopped' });
        }
    });
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

module.exports = {
    attachPlayerEvents,
    createControlButtons,
    cleanTitle,
    isRemixOrLive
};
