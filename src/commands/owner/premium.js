'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const premiumService = require('../../services/premiumService');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('Manage premium settings and status')
        .addSubcommand(sub =>
            sub
                .setName('refresh')
                .setDescription('Force a full premium sync from the website (Owner only)'))
        .addSubcommand(sub =>
            sub
                .setName('status')
                .setDescription('Check premium status for a guild')
                .addStringOption(opt =>
                    opt
                        .setName('guild_id')
                        .setDescription('Guild ID to check (defaults to current server)')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub
                .setName('manage')
                .setDescription('Manage your premium subscription')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        // ── /premium refresh ──────────────────────────────────────────────
        if (sub === 'refresh') {
            // Owner-only guard for refresh
            if (interaction.user.id !== process.env.OWNER_ID) {
                return interaction.reply({
                    content: '❌ This command is restricted to the bot owner.',
                    flags: MessageFlags.Ephemeral,
                });
            }

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
            const info = await premiumService.getPremiumInfo(targetId);

            let periodInfo = 'Unknown';
            if (info && info.current_period_end) {
                const date = new Date(info.current_period_end * 1000); // Unix timestamp
                periodInfo = `<t:${Math.floor(date.getTime() / 1000)}:R>`; // Discord relative timestamp
            } else if (info && info.subscription_period) {
                 periodInfo = info.subscription_period;
            }

            const embed = new EmbedBuilder()
                .setColor(active ? 0x57F287 : 0xED4245)
                .setTitle(active ? '✅ Premium Active' : '❌ Not Premium')
                .addFields(
                    { name: 'Guild ID', value: targetId, inline: true },
                    { name: 'API Result', value: active ? 'Active' : 'Inactive', inline: true },
                );

            if (active && periodInfo !== 'Unknown') {
                 embed.addFields({ name: 'Renews/Ends', value: periodInfo, inline: false });
            }

            embed.setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        // ── /premium manage ───────────────────────────────────────────────
        if (sub === 'manage') {
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('💎 Manage Premium Subscription')
                .setDescription('You can manage your LAVA Premium subscription (powered by Stripe) on our website.\n\n🔗 [Click here to manage your subscription](https://lavabot.site/premium)')
                .setTimestamp();

            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
    },
};
