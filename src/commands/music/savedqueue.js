const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { formatDuration, paginatedEmbed } = require('../../utils/helpers');
const db = require('../../utils/db');
const fs = require('fs');
const path = require('path');

const SAVED_QUEUES_PATH = path.join(process.cwd(), 'saved_queues.json');

// Load/save queue data from JSON file
function loadQueues() {
    try {
        if (fs.existsSync(SAVED_QUEUES_PATH)) {
            return JSON.parse(fs.readFileSync(SAVED_QUEUES_PATH, 'utf8'));
        }
    } catch (e) { console.error('Error loading saved queues:', e); }
    return {};
}

function saveQueues(data) {
    fs.writeFileSync(SAVED_QUEUES_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('savedqueue')
        .setDescription('Save and manage custom queues (Premium)')
        .addSubcommand(sub =>
            sub.setName('save')
                .setDescription('Save the current queue')
                .addStringOption(opt => opt.setName('name').setDescription('Name for the saved queue (max 20 chars)').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('load')
                .setDescription('Load a saved queue')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the queue to load').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('Show all your saved queues'))
        .addSubcommand(sub =>
            sub.setName('details')
                .setDescription('Show tracks in a saved queue')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the queue').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('delete')
                .setDescription('Delete a saved queue')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the queue to delete').setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('addcurrent')
                .setDescription('Add the currently playing track to a saved queue')
                .addStringOption(opt => opt.setName('name').setDescription('Name of the queue').setRequired(true))),
    async execute(interaction) {
        // Premium check
        if (!db.isPremium(interaction.guild.id)) {
            return interaction.reply({
                content: '⭐ This is a **premium** command. Use `/requestpremium` to request premium for your server!',
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const allQueues = loadQueues();

        if (!allQueues[userId]) allQueues[userId] = {};

        switch (sub) {
            case 'save': {
                const name = interaction.options.getString('name').substring(0, 20);
                const queue = interaction.client.queue.get(interaction.guild.id);
                if (!queue || !queue.songs.length) {
                    return interaction.reply({ content: '❌ No queue to save. Play something first!', ephemeral: true });
                }

                if (allQueues[userId][name]) {
                    return interaction.reply({ content: `❌ A queue named \`${name}\` already exists. Delete it first or use a different name.`, ephemeral: true });
                }

                const tracks = queue.songs.map(t => ({
                    title: t.info.title,
                    uri: t.info.uri,
                    author: t.info.author,
                    length: t.info.length,
                    artworkUrl: t.info.artworkUrl
                }));

                allQueues[userId][name] = tracks;
                saveQueues(allQueues);

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle('💾 Queue Saved')
                    .setDescription(`Saved **${tracks.length}** tracks as \`${name}\``);
                return interaction.reply({ embeds: [embed] });
            }

            case 'load': {
                const name = interaction.options.getString('name');
                const saved = allQueues[userId]?.[name];
                if (!saved || !saved.length) {
                    return interaction.reply({ content: `❌ No saved queue found with name \`${name}\`.`, ephemeral: true });
                }

                const { channel } = interaction.member.voice;
                if (!channel) return interaction.reply({ content: '❌ Join a voice channel first!', ephemeral: true });

                await interaction.deferReply();

                const node = interaction.client.shoukaku.getIdealNode();
                if (!node) return interaction.editReply('❌ No Lavalink node available.');

                let queue = interaction.client.queue.get(interaction.guild.id);
                let playerCreated = false;

                if (!queue) {
                    const player = await interaction.client.shoukaku.joinVoiceChannel({
                        guildId: interaction.guild.id,
                        channelId: channel.id,
                        shardId: interaction.guild.shardId,
                        deaf: true
                    });

                    queue = {
                        player,
                        songs: [],
                        textChannel: interaction.channel,
                        loop: 'off',
                        autoplay: false,
                        volume: 100,
                        previousTracks: new Set()
                    };
                    interaction.client.queue.set(interaction.guild.id, queue);
                    playerCreated = true;
                }

                let loaded = 0;
                for (const track of saved) {
                    try {
                        const res = await node.rest.resolve(track.uri || `spsearch:${track.title} ${track.author}`);
                        const resolved = res?.data?.tracks?.[0] || (Array.isArray(res?.data) ? res.data[0] : res?.data);
                        if (resolved) {
                            queue.songs.push(resolved);
                            loaded++;
                        }
                    } catch (e) { continue; }
                }

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setTitle('📂 Queue Loaded')
                    .setDescription(`Loaded **${loaded}/${saved.length}** tracks from \`${name}\``);

                if (playerCreated && queue.songs.length > 0) {
                    queue.player.playTrack({ track: { encoded: queue.songs[0].encoded } });
                }

                return interaction.editReply({ embeds: [embed] });
            }

            case 'list': {
                const userQueues = allQueues[userId];
                const names = Object.keys(userQueues || {});

                if (!names.length) {
                    return interaction.reply({ content: '📭 You have no saved queues. Use `/savedqueue save` while playing music!', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle('📋 Your Saved Queues')
                    .setDescription(names.map(n => `**❯ ${n}** — \`${userQueues[n].length} tracks\``).join('\n'));
                return interaction.reply({ embeds: [embed] });
            }

            case 'details': {
                const name = interaction.options.getString('name');
                const saved = allQueues[userId]?.[name];
                if (!saved || !saved.length) {
                    return interaction.reply({ content: `❌ No saved queue found with name \`${name}\`.`, ephemeral: true });
                }

                await interaction.deferReply();

                const perPage = 10;
                const pages = [];
                for (let i = 0; i < saved.length; i += perPage) {
                    const slice = saved.slice(i, i + perPage);
                    const embed = new EmbedBuilder()
                        .setColor('Blurple')
                        .setTitle(`📋 Queue: ${name} (${saved.length} tracks)`)
                        .setDescription(
                            slice.map((t, j) =>
                                `**${i + j + 1}.** [${t.title}](${t.uri || ''}) — ${t.author || 'Unknown'}`
                            ).join('\n')
                        );
                    pages.push(embed);
                }

                await paginatedEmbed(interaction, pages);
                break;
            }

            case 'delete': {
                const name = interaction.options.getString('name');
                if (!allQueues[userId]?.[name]) {
                    return interaction.reply({ content: `❌ No saved queue found with name \`${name}\`.`, ephemeral: true });
                }

                delete allQueues[userId][name];
                saveQueues(allQueues);

                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setDescription(`🗑️ Deleted saved queue \`${name}\``);
                return interaction.reply({ embeds: [embed] });
            }

            case 'addcurrent': {
                const name = interaction.options.getString('name');
                if (!allQueues[userId]?.[name]) {
                    return interaction.reply({ content: `❌ No saved queue found with name \`${name}\`. Create one first with \`/savedqueue save\`.`, ephemeral: true });
                }

                const queue = interaction.client.queue.get(interaction.guild.id);
                if (!queue || !queue.songs[0]) {
                    return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
                }

                const track = queue.songs[0];
                allQueues[userId][name].push({
                    title: track.info.title,
                    uri: track.info.uri,
                    author: track.info.author,
                    length: track.info.length,
                    artworkUrl: track.info.artworkUrl
                });
                saveQueues(allQueues);

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setDescription(`✅ Added **${track.info.title}** to saved queue \`${name}\``);
                return interaction.reply({ embeds: [embed] });
            }
        }
    }
};
