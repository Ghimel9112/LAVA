const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const blacklist = require('../../utils/blacklist');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removeblacklist')
        .setDescription('Remove a server from the blacklist (Owner only).')
        .addStringOption(option =>
            option.setName('guild_id')
                .setDescription('The ID of the server to unban')
                .setRequired(true)),
    async execute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const guildId = interaction.options.getString('guild_id');

        if (!blacklist.isBlacklisted(guildId)) {
            return interaction.reply({
                content: `Server \`${guildId}\` is not blacklisted.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            blacklist.removeBlacklist(guildId);
            await interaction.reply({
                content: `Successfully removed server \`${guildId}\` from the blacklist.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `Failed to unban server: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
