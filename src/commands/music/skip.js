const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track and play the next one in queue.'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);

        if (!queue) {
            return interaction.reply({ content: 'There is no music playing.', flags: MessageFlags.Ephemeral });
        }

        // Optional: Check if user is in the same voice channel
        const { channel } = interaction.member.voice;
        if (!channel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command!', flags: MessageFlags.Ephemeral });
        }

        // Check if there's a next song (skip allowed even with 1 song when autoplay is on)
        if (queue.songs.length <= 1 && !queue.autoplay) {
            return interaction.reply({ content: 'There are no more tracks in the queue to skip to. Enable autoplay to continue with similar songs.', flags: MessageFlags.Ephemeral });
        }

        try {
            const currentTrack = queue.songs[0];

            // Delete previous message if it exists
            if (queue.lastMessage) {
                try {
                    await queue.lastMessage.delete();
                } catch (err) {
                    // Message might already be deleted
                }
            }

            // Stop the current track (this will trigger the 'end' event and play next song)
            queue.player.stopTrack();

            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setDescription(`⏭️ Skipped: **${currentTrack.info.title}**`);

            const msg = await interaction.reply({ embeds: [embed] });
            queue.lastMessage = msg;
        } catch (error) {
            console.error('Skip command error:', error);
            await interaction.reply({ content: 'Failed to skip the track.', flags: MessageFlags.Ephemeral });
        }
    },
};
