const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('Toggle autoplay mode (automatically play similar songs when queue ends).'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);

        if (!queue) {
            return interaction.reply({ content: 'There is no music playing. Start playing a song first!', flags: MessageFlags.Ephemeral });
        }

        // Optional: Check if user is in the same voice channel
        const { channel } = interaction.member.voice;
        if (!channel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command!', flags: MessageFlags.Ephemeral });
        }

        try {
            // Toggle autoplay mode
            queue.autoplay = !queue.autoplay;

            const embed = new EmbedBuilder()
                .setColor(queue.autoplay ? 'Green' : 'Grey')
                .setDescription(`${queue.autoplay ? '🔁 Autoplay enabled' : '⏹️ Autoplay disabled'}`);

            await interaction.reply({ embeds: [embed] });

            // Auto-delete after 30 seconds
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 30000);
        } catch (error) {
            console.error('Autoplay command error:', error);
            await interaction.reply({ content: 'Failed to toggle autoplay.', flags: MessageFlags.Ephemeral });
        }
    },
};
