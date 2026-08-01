const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { formatDuration } = require('../../utils/helpers');
const premiumService = require('../../services/premiumService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for a song and pick from results')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('Song name to search for')
                .setRequired(true)),
    async execute(interaction) {
        const { channel } = interaction.member.voice;
        if (!channel) return interaction.reply({ content: '❌ You need to be in a voice channel!', flags: MessageFlags.Ephemeral });

        await interaction.deferReply();

        const query = interaction.options.getString('query');
        const node = interaction.client.shoukaku.getIdealNode();
        if (!node) return interaction.editReply('❌ No Lavalink node is available.');

        const isPremium = await premiumService.isPremium(interaction.guild.id);
        const ytDisabled = interaction.client.youtubeDisabled || false;

        let searchPrefix = 'amsearch:';
        let tracks = [];

        // Try Apple Music first for all users
        const amRes = await node.rest.resolve(`amsearch:${query}`);
        if (amRes?.data) {
            tracks = (Array.isArray(amRes.data) ? amRes.data : (amRes.data.tracks || []))
                .filter(t => t && t.info && t.info.title)
                .slice(0, 10);
        }

        // If no AM results and user is premium, try YouTube
        if (tracks.length === 0 && isPremium && !ytDisabled) {
            const ytRes = await node.rest.resolve(`ytsearch:${query}`);
            if (ytRes?.data) {
                tracks = (Array.isArray(ytRes.data) ? ytRes.data : (ytRes.data.tracks || []))
                    .filter(t => t && t.info && t.info.title)
                    .slice(0, 10);
            }
        }

        if (tracks.length === 0) return interaction.editReply('❌ No results found.');

        const options = tracks.map((t, i) => ({
            label: t.info.title.substring(0, 100),
            description: `${t.info.author} • ${formatDuration(t.info.length)}`.substring(0, 100),
            value: i.toString()
        }));

        const selectMenu = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play')
                .addOptions(options)
        );

        const embed = new EmbedBuilder()
            .setColor('Blurple')
            .setTitle(`🔍 Search Results for: "${query}"`)
            .setDescription(tracks.map((t, i) => `**${i + 1}.** [${t.info.title}](${t.info.uri || ''}) — ${t.info.author} \`${formatDuration(t.info.length)}\``).join('\n'))
            .setFooter({ text: 'Select a song from the dropdown below' });

        const message = await interaction.editReply({ embeds: [embed], components: [selectMenu] });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 30000,
            max: 1
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: '❌ Only the command user can select.', flags: MessageFlags.Ephemeral });
            }

            const selectedIndex = parseInt(i.values[0]);
            const selectedTrack = tracks[selectedIndex];
            if (!selectedTrack) return i.reply({ content: '❌ Track not found.', flags: MessageFlags.Ephemeral });

            // Use the play command logic - add to queue or create player
            const playCmd = interaction.client.commands.get('play');
            if (playCmd) {
                // Create a mock interaction with the selected track's URI
                interaction.options = {
                    getString: (name) => name === 'query' ? (selectedTrack.info.uri || selectedTrack.info.title) : null
                };
                // Update the embed to show selection
                const selectedEmbed = new EmbedBuilder()
                    .setColor('Green')
                    .setDescription(`✅ Selected: **${selectedTrack.info.title}** by ${selectedTrack.info.author}`);
                await i.update({ embeds: [selectedEmbed], components: [] });

                // Add to queue directly
                const queue = interaction.client.queue.get(interaction.guild.id);
                if (queue) {
                    queue.songs.push(selectedTrack);
                    if (queue.previousTracks) queue.previousTracks.add(`${selectedTrack.info.author} - ${selectedTrack.info.title}`.toLowerCase());
                } else {
                    // No existing queue - execute play command
                    await playCmd.execute(interaction);
                }
            }
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                try {
                    await message.edit({ components: [] });
                } catch (e) { }
            }
        });
    }
};
