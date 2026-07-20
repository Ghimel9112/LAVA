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
                .setDescription('Manage your premium subscription'))
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('List all premium guild IDs (Owner only)')),

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
                // Check if it's an ISO string or a Unix timestamp
                let date;
                if (typeof info.current_period_end === 'string') {
                    date = new Date(info.current_period_end);
                } else {
                    date = new Date(info.current_period_end * 1000);
                }
                
                if (!isNaN(date.getTime())) {
                    periodInfo = `<t:${Math.floor(date.getTime() / 1000)}:R>`; // Discord relative timestamp
                }
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

        // ── /premium list ─────────────────────────────────────────────────
        if (sub === 'list') {
            // Owner-only guard for list
            if (interaction.user.id !== process.env.OWNER_ID) {
                return interaction.reply({
                    content: '❌ This command is restricted to the bot owner.',
                    flags: MessageFlags.Ephemeral,
                });
            }

            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const guildIds = Array.from(premiumService.premiumGuilds);

            if (guildIds.length === 0) {
                const emptyEmbed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('💎 Premium Guilds (0)')
                    .setDescription('No premium guilds found.')
                    .setTimestamp();
                return interaction.editReply({ embeds: [emptyEmbed] });
            }

            // Resolve each guild + owner from the bot's cache / API
            const lines = await Promise.all(guildIds.map(async (id) => {
                try {
                    const guild = interaction.client.guilds.cache.get(id)
                        ?? await interaction.client.guilds.fetch(id).catch(() => null);

                    if (!guild) return `• \`${id}\` — *(bot not in this server)*`;

                    let ownerTag = 'Unknown';
                    try {
                        const owner = await guild.fetchOwner();
                        ownerTag = `${owner.user.tag} (\`${owner.id}\`)`;
                    } catch (_) { /* owner fetch failed */ }

                    return `• **${guild.name}** [\`${id}\`]\n  👑 Owner: ${ownerTag}`;
                } catch {
                    return `• \`${id}\` — *(fetch failed)*`;
                }
            }));

            // Discord embeds cap at 4096 chars — chunk if needed
            const chunks = [];
            let current = '';
            for (const line of lines) {
                if ((current + '\n' + line).length > 3900) {
                    chunks.push(current);
                    current = line;
                } else {
                    current = current ? current + '\n\n' + line : line;
                }
            }
            if (current) chunks.push(current);

            const embeds = chunks.map((chunk, i) => {
                const e = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setDescription(chunk)
                    .setTimestamp();
                if (i === 0) e.setTitle(`💎 Premium Guilds (${guildIds.length})`);
                return e;
            });

            return interaction.editReply({ embeds });
        }
    },
};
