const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab')
        .setDescription('Save the currently playing song info to your DMs'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        const track = queue.songs[0];

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('💾 Saved Song')
            .setDescription(`**[${track.info.title}](${track.info.uri || ''})**`)
            .addFields(
                { name: 'Artist', value: track.info.author || 'Unknown', inline: true },
                { name: 'Duration', value: formatDuration(track.info.length), inline: true },
                { name: 'Source', value: track.info.sourceName || 'Unknown', inline: true },
                { name: 'Play Command', value: `\`/play query:${track.info.uri || track.info.title}\`` },
                { name: 'Saved From', value: `<#${interaction.channel.id}>` }
            )
            .setFooter({ text: `Saved from ${interaction.guild.name}` })
            .setTimestamp();

        if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

        try {
            await interaction.user.send({ embeds: [embed] });
            return interaction.reply({ content: '💾 Song info has been sent to your DMs!', flags: MessageFlags.Ephemeral });
        } catch (e) {
            return interaction.reply({ content: '❌ Could not send DM. Please check your privacy settings.', flags: MessageFlags.Ephemeral });
        }
    }
};
