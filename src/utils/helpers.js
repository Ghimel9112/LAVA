const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

/**
 * Format milliseconds into HH:MM:SS or MM:SS
 */
function formatDuration(ms) {
    if (!ms || ms === 0) return '◉ LIVE';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Create a visual progress bar for the current track
 */
function createBar(position, duration, size = 20) {
    if (!duration || duration === 0) {
        return `**[🔷${'▬'.repeat(size - 1)}]**\n**00:00 / ◉ LIVE**`;
    }

    const progress = Math.min(position / duration, 1);
    const filledSize = Math.round(size * progress);
    const emptySize = size - filledSize;

    const bar = '▬'.repeat(Math.max(0, filledSize - 1)) + '🔷' + '▬'.repeat(emptySize);
    return `**[${bar}]**\n**${formatDuration(position)} / ${formatDuration(duration)}**`;
}

/**
 * Format uptime duration from milliseconds
 */
function formatUptime(ms) {
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds) parts.push(`${seconds}s`);
    return parts.join(' ') || '0s';
}

/**
 * Create paginated embed navigation with buttons
 * @param {Interaction} interaction 
 * @param {EmbedBuilder[]} embeds 
 * @param {number} timeout - Time in ms before buttons expire (default: 120s)
 */
async function paginatedEmbed(interaction, embeds, timeout = 120000) {
    if (embeds.length === 0) return;
    if (embeds.length === 1) {
        return interaction.editReply({ embeds: [embeds[0]] });
    }

    let currentPage = 0;

    // Add page footer to all embeds
    embeds.forEach((embed, i) => {
        embed.setFooter({ text: `Page ${i + 1} / ${embeds.length}` });
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('page_first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('page_back').setEmoji('◀️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('page_home').setEmoji('🏠').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('page_forward').setEmoji('▶️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('page_last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary)
    );

    const message = await interaction.editReply({
        embeds: [embeds[0]],
        components: [row]
    });

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: timeout
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            return i.reply({ content: 'Only the command user can navigate pages.', flags: MessageFlags.Ephemeral });
        }

        switch (i.customId) {
            case 'page_first': currentPage = 0; break;
            case 'page_back': currentPage = currentPage > 0 ? currentPage - 1 : embeds.length - 1; break;
            case 'page_home': currentPage = 0; break;
            case 'page_forward': currentPage = currentPage < embeds.length - 1 ? currentPage + 1 : 0; break;
            case 'page_last': currentPage = embeds.length - 1; break;
        }

        await i.update({ embeds: [embeds[currentPage]], components: [row] });
    });

    collector.on('end', async () => {
        const disabledRow = ActionRowBuilder.from(row);
        disabledRow.components.forEach(c => c.setDisabled(true));
        try {
            await message.edit({ components: [disabledRow] });
        } catch (e) { /* Message may be deleted */ }
    });
}

module.exports = {
    formatDuration,
    createBar,
    formatUptime,
    paginatedEmbed
};
