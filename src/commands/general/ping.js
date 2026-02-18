const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency'),
    async execute(interaction) {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });

        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const ws = interaction.client.ws.ping;

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle('🏓 Pong!')
            .addFields(
                { name: '📡 API Latency', value: `\`${roundtrip}ms\``, inline: true },
                { name: '💓 WebSocket', value: `\`${ws}ms\``, inline: true }
            );

        await interaction.editReply({ content: null, embeds: [embed] });
    }
};
