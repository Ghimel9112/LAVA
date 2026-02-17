const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the current track and skip to the next one.'),
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

        try {
            // Stop the current track (this will trigger the 'end' event and play next song if available)
            queue.player.stopTrack();

            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setDescription('⏭️ Stopped the current track.');

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Stop command error:', error);
            await interaction.reply({ content: 'Failed to stop the track.', flags: MessageFlags.Ephemeral });
        }
    },
};
