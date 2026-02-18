const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration, createBar } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forward')
        .setDescription('Skip forward by a number of seconds')
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Number of seconds to skip forward')
                .setRequired(true)
                .setMinValue(1)),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const track = queue.songs[0];
        if (!track.info.length || track.info.length === 0) {
            return interaction.reply({ content: '❌ Cannot seek in a live stream.', ephemeral: true });
        }

        const seconds = interaction.options.getInteger('seconds');
        const currentPos = queue.player.position || 0;
        let newPos = currentPos + (seconds * 1000);

        if (newPos >= track.info.length) newPos = track.info.length - 1000;

        queue.player.seekTo(newPos);

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`⏩ Forwarded **${seconds}s**\n\n${createBar(newPos, track.info.length)}`);
        return interaction.reply({ embeds: [embed] });
    }
};
