const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue')
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('Position of the track to remove')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || queue.songs.length < 2) {
            return interaction.reply({ content: '❌ The queue has no tracks to remove.', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', flags: MessageFlags.Ephemeral });
        }

        const position = interaction.options.getInteger('position');

        if (position >= queue.songs.length) {
            return interaction.reply({ content: `❌ Invalid position. The queue has **${queue.songs.length - 1}** tracks.`, flags: MessageFlags.Ephemeral });
        }

        const [removed] = queue.songs.splice(position, 1);

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setDescription(`🗑️ Removed **${removed.info.title}** from position **#${position}**`);
        return interaction.reply({ embeds: [embed] });
    }
};
