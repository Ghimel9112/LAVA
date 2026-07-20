'use strict';

const { MessageFlags } = require('discord.js');
const premiumService = require('../services/premiumService');

/**
 * Checks whether the interaction's guild has premium.
 * If it does, returns true.
 * If it doesn't, replies ephemerally with a link to the premium page and returns false.
 *
 * Usage in any command:
 *   if (!await requirePremium(interaction)) return;
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function requirePremium(interaction) {
    const active = await premiumService.isPremium(interaction.guild.id);
    if (active) return true;

    await interaction.reply({
        content: '⭐ **This is a premium feature.**\nUse `/premium manage` or visit <https://lavabot.site/premium> to unlock it.',
        flags: MessageFlags.Ephemeral,
    });
    return false;
}

module.exports = { requirePremium };
