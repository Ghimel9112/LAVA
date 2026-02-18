const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatUptime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Show how long the bot has been running'),
    async execute(interaction) {
        const uptime = formatUptime(interaction.client.uptime);

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`⏱️ Bot has been online for **${uptime}**`);
        return interaction.reply({ embeds: [embed] });
    }
};
