const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all available commands')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('Get details about a specific command')),
    async execute(interaction) {
        const specificCmd = interaction.options.getString('command');

        if (specificCmd) {
            const cmd = interaction.client.commands.get(specificCmd.toLowerCase());
            if (!cmd) return interaction.reply({ content: `❌ Command \`${specificCmd}\` not found.`, flags: MessageFlags.Ephemeral });

            const embed = new EmbedBuilder()
                .setColor('Blurple')
                .setTitle(`📋 Command: /${cmd.data.name}`)
                .setDescription(cmd.data.description || 'No description available.')
                .addFields({ name: 'Usage', value: `\`/${cmd.data.name}\`` });

            if (cmd.data.options?.length) {
                const opts = cmd.data.options.map(o => {
                    const required = o.required ? '`[required]`' : '`[optional]`';
                    return `• **${o.name}** — ${o.description} ${required}`;
                }).join('\n');
                embed.addFields({ name: 'Options', value: opts });
            }

            return interaction.reply({ embeds: [embed] });
        }

        // Group commands by category (folder)
        const categories = new Map();
        const categoryEmojis = {
            general: '📋',
            music: '🎶',
            moderation: '🛡️',
            owner: '👑'
        };

        interaction.client.commands.forEach(cmd => {
            // Determine category from the file path
            const category = cmd.category || 'general';
            if (!categories.has(category)) categories.set(category, []);
            categories.get(category).push(cmd);
        });

        const pages = [];

        // Home page
        const home = new EmbedBuilder()
            .setColor('Red')
            .setTitle('🚁 Lava Bot — Help Menu')
            .setDescription('Navigate through categories using the buttons below.')
            .setThumbnail(interaction.client.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        let fieldValue = '';
        categories.forEach((cmds, cat) => {
            const emoji = categoryEmojis[cat] || '📁';
            fieldValue += `${emoji} **${cat.charAt(0).toUpperCase() + cat.slice(1)}** — ${cmds.length} command${cmds.length > 1 ? 's' : ''}\n`;
        });
        home.addFields({ name: 'Categories', value: fieldValue || 'No commands loaded.' });

        const totalCmds = interaction.client.commands.size;
        home.setFooter({ text: `${totalCmds} total commands • Use /help <command> for details` });
        pages.push(home);

        // Category pages
        categories.forEach((cmds, cat) => {
            const emoji = categoryEmojis[cat] || '📁';
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle(`${emoji} ${cat.charAt(0).toUpperCase() + cat.slice(1)} Commands`)
                .setDescription(cmds.map(c => `\`/${c.data.name}\` — ${c.data.description}`).join('\n'));
            pages.push(embed);
        });

        // Paginated navigation
        let currentPage = 0;
        pages.forEach((p, i) => p.setFooter({ text: `Page ${i + 1}/${pages.length} • Use /help <command> for details` }));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('help_home').setEmoji('🏠').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('help_back').setEmoji('◀️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('help_forward').setEmoji('▶️').setStyle(ButtonStyle.Primary)
        );

        const message = await interaction.reply({ embeds: [pages[0]], components: [row], fetchReply: true });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 120000
        });

        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: 'Only the command user can navigate.', flags: MessageFlags.Ephemeral });
            }

            switch (i.customId) {
                case 'help_home': currentPage = 0; break;
                case 'help_back': currentPage = currentPage > 0 ? currentPage - 1 : pages.length - 1; break;
                case 'help_forward': currentPage = currentPage < pages.length - 1 ? currentPage + 1 : 0; break;
            }

            await i.update({ embeds: [pages[currentPage]], components: [row] });
        });

        collector.on('end', async () => {
            const disabledRow = ActionRowBuilder.from(row);
            disabledRow.components.forEach(c => c.setDisabled(true));
            try { await message.edit({ components: [disabledRow] }); } catch (e) { }
        });
    }
};
