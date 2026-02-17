const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');

function formatDuration(ms) {
    if (!ms || ms <= 0) return 'Live';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('View and manage the current music queue.'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);

        if (!queue || !queue.songs.length) {
            return interaction.reply({ content: 'There is no music playing right now.', flags: MessageFlags.Ephemeral });
        }

        const currentTrack = queue.songs[0];

        // Build the embed showing now playing
        const embed = new EmbedBuilder()
            .setColor('Red')
            .setAuthor({ name: 'Music Queue', iconURL: 'https://media.tenor.com/I5kylHJduP4AAAAj/disc-spinning.gif' })
            .setDescription(`**Now Playing:**\n🎶 **[${truncate(currentTrack.info.title, 60)}](${currentTrack.info.uri || ''})** — ${currentTrack.info.author} \`[${formatDuration(currentTrack.info.length)}]\``);

        if (currentTrack.info.artworkUrl) embed.setThumbnail(currentTrack.info.artworkUrl);

        // Check if there are songs in queue beyond the current one
        const upcoming = queue.songs.slice(1, 11); // Next 10 songs

        if (upcoming.length === 0) {
            embed.addFields({ name: 'Up Next', value: 'The queue is empty.' });
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        // Add a text list to the embed for quick overview
        const queueList = upcoming.map((track, i) =>
            `\`${i + 1}.\` **${truncate(track.info.title, 45)}** — ${track.info.author} \`[${formatDuration(track.info.length)}]\``
        ).join('\n');

        embed.addFields({ name: `Up Next (${queue.songs.length - 1} total)`, value: queueList });

        // Build the select menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('queue_select')
            .setPlaceholder('Select a song to manage...')
            .addOptions(
                upcoming.map((track, i) => ({
                    label: truncate(`${i + 1}. ${track.info.title}`, 100),
                    description: truncate(`${track.info.author} • ${formatDuration(track.info.length)}`, 100),
                    value: String(i + 1), // Index in queue.songs (1-based, since 0 is current)
                }))
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
};
