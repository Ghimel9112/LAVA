const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replay')
        .setDescription('Replay the current track from the beginning'),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue || !queue.songs[0]) {
            return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
        }

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        queue.player.seekTo(0);

        const track = queue.songs[0];
        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`🔄 Replaying **${track.info.title}** from the beginning!`);
        return interaction.reply({ embeds: [embed] });
    }
};
