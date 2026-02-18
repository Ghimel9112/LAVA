const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused playback'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        if (!queue.player.paused) {
            return interaction.reply({ content: '❌ The player is not paused.', ephemeral: true });
        }

        queue.player.setPaused(false);
        queue.paused = false;

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription('▶️ Resumed playback!');
        return interaction.reply({ embeds: [embed] });
    }
};
