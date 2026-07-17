'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const premiumService = require('../../services/premiumService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('Manage premium sync (Owner only)')
        .addSubcommand(sub =>
            sub
                .setName('refresh')
                .setDescription('Force a full premium sync from the website'))
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('Check premium status for a guild')
                .addStringOption(opt =>
                    opt
                        .setName('guild_id')
                        .setDescription('Guild ID to check (defaults to current server)')
                        .setRequired(false))),

    async execute(interaction) {
        // Owner-only guard
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: '❌ This command is restricted to the bot owner.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const sub = interaction.options.getSubcommand();

        // ── /premium refresh ──────────────────────────────────────────────
        if (sub === 'refresh') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            await premiumService.syncAll();

            const count = premiumService.premiumGuilds.size;
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle('✅ Premium Synced')
                .setDescription(`Cached **${count}** premium guild(s).`)
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ── /premium status [guild_id] ────────────────────────────────────
        if (sub === 'status') {
            const targetId = interaction.options.getString('guild_id') ?? interaction.guild.id;
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const active = await premiumService.isPremium(targetId);
            const inSet = premiumService.premiumGuilds.has(String(targetId));

            const embed = new EmbedBuilder()
                .setColor(active ? 0x57F287 : 0xED4245)
                .setTitle(active ? '✅ Premium Active' : '❌ Not Premium')
                .addFields(
                    { name: 'Guild ID', value: targetId, inline: true },
                    { name: 'In Memory Set', value: inSet ? 'Yes' : 'No', inline: true },
                    { name: 'API Result', value: active ? 'Active' : 'Inactive', inline: true },
                )
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
    },
};
