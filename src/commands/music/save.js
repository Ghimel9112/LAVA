const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('save')
        .setDescription('Saves the current song to your DMs'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);

        if (!queue || !queue.songs || queue.songs.length === 0) {
            return interaction.reply({ content: 'There is no music playing right now!', flags: MessageFlags.Ephemeral });
        }

        const currentTrack = queue.songs[0];

        try {
            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('💾 Saved Song')
                .setDescription(`You saved **[${currentTrack.info.title}](${currentTrack.info.uri || ''})**`)
                .addFields(
                    { name: 'Artist', value: currentTrack.info.author, inline: true },
                    { name: 'Source', value: currentTrack.info.sourceName, inline: true },
                    { name: 'Duration', value: `${Math.floor(currentTrack.info.length / 60000)}:${Math.floor((currentTrack.info.length % 60000) / 1000).toString().padStart(2, '0')}`, inline: true }
                )
                .setFooter({ text: `Saved from ${interaction.guild.name}` });

            if (currentTrack.info.artworkUrl) {
                embed.setThumbnail(currentTrack.info.artworkUrl);
            }

            await interaction.user.send({ embeds: [embed] });

            return interaction.reply({ content: 'I have sent the song to your DMs!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Failed to DM user:', error);
            return interaction.reply({ content: 'I could not send you a DM. Please check your privacy settings.', flags: MessageFlags.Ephemeral });
        }
    },
};
