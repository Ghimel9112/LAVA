const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { paginatedEmbed } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverlist')
        .setDescription('List all servers the bot is in (owner only)'),
    async execute(interaction) {
        // Owner-only check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot owner.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guilds = interaction.client.guilds.cache
            .sort((a, b) => b.memberCount - a.memberCount)
            .map((g, i) => g);

        if (guilds.length === 0) {
            return interaction.editReply('Not in any servers.');
        }

        // Split into pages of 10
        const pages = [];
        const perPage = 10;
        const guildArray = [...guilds.values()];

        for (let i = 0; i < guildArray.length; i += perPage) {
            const slice = guildArray.slice(i, i + perPage);
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle(`📋 Server List (${guildArray.length} total)`)
                .setDescription(
                    slice.map((g, j) =>
                        `**${i + j + 1}.** ${g.name}\n` +
                        `> ID: \`${g.id}\`\n` +
                        `> Members: **${g.memberCount}** | Owner: <@${g.ownerId}>`
                    ).join('\n\n')
                );
            pages.push(embed);
        }

        await paginatedEmbed(interaction, pages);
    }
};
