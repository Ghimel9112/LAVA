const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Display information about the bot.'),
    async execute(interaction) {
        const client = interaction.client;

        // Calculate uptime
        const totalSeconds = Math.floor(client.uptime / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let uptimeStr = '';
        if (days > 0) uptimeStr += `${days} Days `;
        if (hours > 0) uptimeStr += `${hours} Hrs `;
        uptimeStr += `${minutes} Mins ${seconds} Secs`;

        // Stats
        const commandCount = client.commands.size;
        const guildCount = client.guilds.cache.size;
        const ping = client.ws.ping;

        const embed = new EmbedBuilder()
            .setColor('#2b2d31')
            .setAuthor({
                name: `Information about ${client.user.username}`,
                url: 'https://discord.gg/RaptorKingdom'
            })
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setDescription(
                `**💪 My Features**\n` +
                `🎵 An advanced **Music System** with **Audio Filtering**\n` +
                `✨ A unique Music Request System and way much more!\n` +
                `☑️ Why does the bot needs the administration permission?\n` +
                `Because it makes it easier for me to code it and top not get any errors!!\n\n` +
                `**❓ How do you use me?**\n\n` +
                `\`/play <SONGNAME/SONGLINK>\` to play a song, then connect to a **VC** and type your wished Song!\n\n` +
                `You can also use other commands like \`/skip\`, \`/stop\`, \`/pause\`, \`/autoplay\` and more!\n\n` +
                `**📊 STATS:**\n` +
                `⚙️ **${commandCount} Commands**\n` +
                `📁 on **${guildCount} Guilds**\n` +
                `⏱ \`${uptimeStr.trim()}\` **Uptime**\n` +
                `📶 \`${ping}ms\` **Ping**\n\n` +
                `Made by [**Ghimel**](https://discord.gg/RaptorKingdom)`
            )
            .setFooter({
                text: `Page Overview • ${client.user.username}`,
                iconURL: client.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
