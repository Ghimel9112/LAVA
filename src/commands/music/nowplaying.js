const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration, createBar } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show information about the currently playing track'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', flags: MessageFlags.Ephemeral });
        }

        const track = queue.songs[0];
        const position = queue.player.position || 0;
        const duration = track.info.length || 0;

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setAuthor({ name: 'Now Playing', iconURL: 'https://media.tenor.com/I5kylHJduP4AAAAj/disc-spinning.gif' })
            .setTitle(track.info.title)
            .setURL(track.info.uri || null)
            .setDescription([
                `**Artist:** ${track.info.author}`,
                `**Source:** ${track.info.sourceName || 'Unknown'}`,
                `**Duration:** ${formatDuration(duration)}`,
                '',
                createBar(position, duration)
            ].join('\n'))
            .addFields(
                { name: 'Loop', value: queue.loop === 'off' ? '❌ Off' : queue.loop === 'track' ? '🔂 Track' : '🔁 Queue', inline: true },
                { name: 'Autoplay', value: queue.autoplay ? '✅ On' : '❌ Off', inline: true },
                { name: 'Volume', value: `${queue.volume ?? 100}%`, inline: true }
            );

        if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

        return interaction.reply({ embeds: [embed] });
    }
};
