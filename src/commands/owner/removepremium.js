const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removepremium')
        .setDescription('Remove a server from the premium list (Owner only).')
        .addStringOption(option =>
            option.setName('guild_id')
                .setDescription('The ID of the server to remove')
                .setRequired(true)),
    async execute(interaction) {
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const guildId = interaction.options.getString('guild_id');

        if (!db.isPremium(guildId)) {
            return interaction.reply({
                content: `Server \`${guildId}\` is not in the premium list.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            db.removePremium(guildId);
            await interaction.reply({
                content: `Successfully removed server \`${guildId}\` from premium list.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `Failed to remove server: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
