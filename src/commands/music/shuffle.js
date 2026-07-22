const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the current queue'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || queue.songs.length < 3) {
            return interaction.reply({ content: '❌ Not enough songs in the queue to shuffle (need at least 2 besides current).', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', flags: MessageFlags.Ephemeral });
        }

        // Shuffle everything except the currently playing track (index 0)
        for (let i = queue.songs.length - 1; i > 1; i--) {
            const j = 1 + Math.floor(Math.random() * i);
            [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
        }

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`🔀 Shuffled **${queue.songs.length - 1}** songs in the queue!`);
        return interaction.reply({ embeds: [embed] });
    }
};
