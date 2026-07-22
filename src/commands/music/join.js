const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join your voice channel without playing anything'),
    async execute(interaction) {
        const { channel } = interaction.member.voice;
        if (!channel) return interaction.reply({ content: '❌ You need to be in a voice channel!', flags: MessageFlags.Ephemeral });

        const permissions = channel.permissionsFor(interaction.client.user);
        if (!permissions.has('Connect') || !permissions.has('Speak')) {
            return interaction.reply({ content: '❌ I need **Connect** and **Speak** permissions in that channel!', flags: MessageFlags.Ephemeral });
        }

        // Check if already in a channel
        const existing = interaction.client.shoukaku.players.get(interaction.guild.id);
        if (existing) {
            return interaction.reply({ content: '❌ I\'m already connected to a voice channel.', flags: MessageFlags.Ephemeral });
        }

        try {
            await interaction.client.shoukaku.joinVoiceChannel({
                guildId: interaction.guild.id,
                channelId: channel.id,
                shardId: interaction.guild.shardId,
                deaf: true
            });

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setDescription(`🎤 Joined **${channel.name}**`);
            return interaction.reply({ embeds: [embed] });
        } catch (e) {
            console.error('Join error:', e);
            return interaction.reply({ content: '❌ Failed to join the voice channel.', flags: MessageFlags.Ephemeral });
        }
    }
};
