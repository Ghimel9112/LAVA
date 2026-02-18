const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Set the loop mode')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('Loop mode')
                .setRequired(true)
                .addChoices(
                    { name: '❌ Off', value: 'off' },
                    { name: '🔂 Track', value: 'track' },
                    { name: '🔁 Queue', value: 'queue' }
                )),
    async execute(interaction) {
        const queue = interaction.client.queue.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });

        if (!interaction.member.voice.channelId || interaction.member.voice.channelId !== interaction.guild.members.me.voice?.channelId) {
            return interaction.reply({ content: '❌ You need to be in the same voice channel!', ephemeral: true });
        }

        const mode = interaction.options.getString('mode');
        queue.loop = mode;

        const labels = { off: '❌ Disabled', track: '🔂 Looping current track', queue: '🔁 Looping entire queue' };
        const embed = new EmbedBuilder()
            .setColor('Green')
            .setDescription(`Loop mode: **${labels[mode]}**`);
        return interaction.reply({ embeds: [embed] });
    }
};
