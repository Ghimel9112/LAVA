const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('user').setDescription('User to unmute').setRequired(true)),
    async execute(interaction) {
        const target = interaction.options.getMember('user');

        if (!target) return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
        if (!target.moderatable) return interaction.reply({ content: '❌ I cannot modify this user.', ephemeral: true });

        if (!target.communicationDisabledUntil) {
            return interaction.reply({ content: '❌ This user is not muted.', ephemeral: true });
        }

        try {
            await target.timeout(null);

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('🔊 User Unmuted')
                .addFields(
                    { name: 'User', value: `${target.user.tag}`, inline: true },
                    { name: 'Moderator', value: interaction.user.tag, inline: true }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        } catch (e) {
            return interaction.reply({ content: `❌ Failed to unmute: ${e.message}`, ephemeral: true });
        }
    }
};
