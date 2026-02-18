const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { formatDuration } = require('../../utils/helpers');

// Parse duration strings like "5m", "1h", "30s", "1d"
function parseDuration(str) {
    const match = str.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
    if (!match) return null;
    const val = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, hour: 3600000, d: 86400000, day: 86400000 };
    return val * (multipliers[unit] || 60000);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(opt => opt.setName('user').setDescription('User to mute').setRequired(true))
        .addStringOption(opt => opt.setName('duration').setDescription('Duration (e.g. 5m, 1h, 1d)').setRequired(true))
        .addStringOption(opt => opt.setName('reason').setDescription('Reason for the mute')),
    async execute(interaction) {
        const target = interaction.options.getMember('user');
        const durationStr = interaction.options.getString('duration');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        if (!target) return interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
        if (!target.moderatable) return interaction.reply({ content: '❌ I cannot mute this user. They may have higher permissions.', ephemeral: true });

        const ms = parseDuration(durationStr);
        if (!ms) return interaction.reply({ content: '❌ Invalid duration. Use formats like `5m`, `1h`, `1d`.', ephemeral: true });
        if (ms > 28 * 86400000) return interaction.reply({ content: '❌ Maximum timeout duration is 28 days.', ephemeral: true });

        try {
            await target.timeout(ms, reason);

            const embed = new EmbedBuilder()
                .setColor('Orange')
                .setTitle('🔇 User Muted')
                .addFields(
                    { name: 'User', value: `${target.user.tag}`, inline: true },
                    { name: 'Duration', value: durationStr, inline: true },
                    { name: 'Reason', value: reason },
                    { name: 'Moderator', value: interaction.user.tag }
                )
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        } catch (e) {
            return interaction.reply({ content: `❌ Failed to mute: ${e.message}`, ephemeral: true });
        }
    }
};
