const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { formatDuration } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Show or set the playback volume')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Volume level (0-150)')
                .setMinValue(0)
                .setMaxValue(150)),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const amount = interaction.options.getInteger('amount');

        if (amount === null) {
            const currentVol = queue.volume ?? 100;
            const embed = new EmbedBuilder()
                .setColor('Blue')
                .setDescription(`🔊 Current volume: **${currentVol}%**`);
            return interaction.reply({ embeds: [embed] });
        }

        queue.player.setGlobalVolume(amount);
        queue.volume = amount;

        const emoji = amount === 0 ? '🔇' : amount < 50 ? '🔉' : '🔊';
        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`${emoji} Volume set to **${amount}%**`);
        return interaction.reply({ embeds: [embed] });
    }
};
