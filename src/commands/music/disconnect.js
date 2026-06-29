const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect the bot from the voice channel and clear the queue.'),
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
            // Stop and clean up
            queue.player.stopTrack();
            queue.isIntentionalLeave = true;
            await interaction.client.shoukaku.leaveVoiceChannel(interaction.guild.id);

            const embed = new EmbedBuilder()
                .setColor('Red')
                .setDescription('🛑 Stopped the music and cleared the queue.');

            await interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Stop command error:', error);
            await interaction.reply({ content: 'Failed to stop player.', flags: MessageFlags.Ephemeral });
        }
    },
};
