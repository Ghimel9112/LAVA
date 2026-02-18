const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track to a different position in the queue')
        .addIntegerOption(option =>
            option.setName('from')
                .setDescription('Position of the track to move')
                .setRequired(true)
                .setMinValue(1))
        .addIntegerOption(option =>
            option.setName('to')
                .setDescription('New position for the track')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || queue.songs.length < 2) {
            return interaction.reply({ content: '❌ The queue has no tracks to move.', ephemeral: true });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const from = interaction.options.getInteger('from');
        const to = interaction.options.getInteger('to');

        if (from >= queue.songs.length || to >= queue.songs.length) {
            return interaction.reply({ content: `❌ Invalid position. The queue has **${queue.songs.length - 1}** tracks.`, ephemeral: true });
        }

        const [movedTrack] = queue.songs.splice(from, 1);
        queue.songs.splice(to, 0, movedTrack);

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`📦 Moved **${movedTrack.info.title}** from position **#${from}** to **#${to}**`);
        return interaction.reply({ embeds: [embed] });
    }
};
