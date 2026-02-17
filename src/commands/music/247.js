const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('247')
        .setDescription('Toggle 24/7 mode — keep the bot in the voice channel indefinitely. (Premium only)'),
    async execute(interaction) {
        // Premium check
        if (!db.isPremium(interaction.guild.id)) {
            return interaction.reply({
                content: '⭐ This is a **premium-only** feature. Request premium access with `/requestpremium`.',
                flags: MessageFlags.Ephemeral
            });
        }

        const queue = interaction.client.queue.get(interaction.guild.id);

        if (!queue) {
            return interaction.reply({ content: 'There is no active music session. Play something first!', flags: MessageFlags.Ephemeral });
        }

        // Check if user is in a voice channel
        const { channel } = interaction.member.voice;
        if (!channel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command!', flags: MessageFlags.Ephemeral });
        }

        // Toggle 24/7 mode
        queue.twentyFourSeven = !queue.twentyFourSeven;

        const embed = new EmbedBuilder()
            .setColor(queue.twentyFourSeven ? 'Green' : 'Red')
            .setDescription(queue.twentyFourSeven
                ? '🌙 **24/7 mode enabled** — I will stay in the voice channel even when the queue is empty.'
                : '☀️ **24/7 mode disabled** — I will leave the voice channel when the queue ends.'
            );

        await interaction.reply({ embeds: [embed] });
    },
};
