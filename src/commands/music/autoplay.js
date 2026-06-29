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

        // Check if user is in a voice channel
        const { channel } = interaction.member.voice;
        if (!channel) {
            return interaction.reply({ content: 'You need to be in a voice channel to use this command!', flags: MessageFlags.Ephemeral });
        }

        // Add a check: if the user is not in the same voice channel as the bot, reply with an ephemeral error.
        if (interaction.guild.members.me.voice.channelId && interaction.guild.members.me.voice.channelId !== channel.id) {
            return interaction.reply({ content: 'You must be in the same voice channel as me to toggle autoplay!', flags: MessageFlags.Ephemeral });
        }

        try {
            // Toggle autoplay mode
            queue.autoplay = !queue.autoplay;

            // Get the name of the currently playing song
            const currentSongName = queue.songs.length > 0 ? queue.songs[0].info.title : 'Nothing playing';
            // Calculate how many songs are left in the queue (excluding the currently playing one)
            const songsLeft = Math.max(0, queue.songs.length - 1);

            // Improve the embed to show current autoplay state, current song, and a footer with queue length
            const embed = new EmbedBuilder()
                .setColor(queue.autoplay ? 'Green' : 'Grey')
                .setTitle(queue.autoplay ? '🔁 Autoplay Enabled' : '🔁 Autoplay Disabled')
                .setDescription(`**Currently Playing:** ${currentSongName}`)
                .setFooter({ text: `Songs left in queue: ${songsLeft}` });

            await interaction.reply({ embeds: [embed] });

            // Keep the 30-second auto-delete behavior
            setTimeout(() => {
                interaction.deleteReply().catch(() => { });
            }, 30000);
        } catch (error) {
            console.error('Autoplay command error:', error);
            await interaction.reply({ content: 'Failed to toggle autoplay.', flags: MessageFlags.Ephemeral });
        }
    },
};
