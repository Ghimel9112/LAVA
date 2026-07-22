const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('toggleyt')
        .setDescription('Toggle YouTube sources on/off globally (owner only)'),
    async execute(interaction) {
        // Owner-only check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot owner.', flags: MessageFlags.Ephemeral });
        }

        // Toggle the global flag
        interaction.client.youtubeDisabled = !interaction.client.youtubeDisabled;

        const status = interaction.client.youtubeDisabled ? 'DISABLED' : 'ENABLED';
        const color = interaction.client.youtubeDisabled ? 'Red' : 'Green';
        const emoji = interaction.client.youtubeDisabled ? '🔴' : '🟢';

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`${emoji} YouTube Sources ${status}`)
            .setDescription(
                interaction.client.youtubeDisabled
                    ? 'YouTube sources have been **disabled** globally.\n\nAll YouTube URLs and direct YouTube searches will be blocked. The bot will use alternative sources (Spotify, SoundCloud) instead.'
                    : 'YouTube sources have been **enabled** globally.\n\nPremium servers can now use YouTube directly again.'
            )
            .setFooter({ text: `Toggled by ${interaction.user.tag}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
