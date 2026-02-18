const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearqueue')
        .setDescription('Clear all tracks from the queue (keeps current track playing)'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || queue.songs.length < 2) {
            return interaction.reply({ content: '❌ The queue is already empty.', ephemeral: true });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const count = queue.songs.length - 1;
        queue.songs.splice(1); // Keep only the currently playing track

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setDescription(`🗑️ Cleared **${count}** track(s) from the queue.`);
        return interaction.reply({ embeds: [embed] });
    }
};
