const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration, createBar } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific position in the current track')
        .addIntegerOption(option =>
            option.setName('seconds')
                .setDescription('Position in seconds to seek to')
                .setRequired(true)
                .setMinValue(0)),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', flags: MessageFlags.Ephemeral });
        }

        const track = queue.songs[0];
        if (!track.info.length || track.info.length === 0) {
            return interaction.reply({ content: '❌ Cannot seek in a live stream.', flags: MessageFlags.Ephemeral });
        }

        const seconds = interaction.options.getInteger('seconds');
        const seekMs = seconds * 1000;

        if (seekMs >= track.info.length) {
            return interaction.reply({ content: `❌ Cannot seek past the track duration (${formatDuration(track.info.length)}).`, flags: MessageFlags.Ephemeral });
        }

        queue.player.seekTo(seekMs);

        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`⏩ Seeked to **${formatDuration(seekMs)}**\n\n${createBar(seekMs, track.info.length)}`);
        return interaction.reply({ embeds: [embed] });
    }
};
