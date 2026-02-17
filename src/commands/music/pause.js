const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause or resume the current track.'),
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
            const player = queue.player;

            // Toggle pause/resume
            if (player.paused) {
                await player.setPaused(false);
                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setDescription('▶️ Resumed the music.');
                await interaction.reply({ embeds: [embed] });
            } else {
                await player.setPaused(true);
                const embed = new EmbedBuilder()
                    .setColor('Yellow')
                    .setDescription('⏸️ Paused the music.');
                await interaction.reply({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Pause command error:', error);
            await interaction.reply({ content: 'Failed to pause/resume player.', flags: MessageFlags.Ephemeral });
        }
    },
};
