const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');
const { formatUptime } = require('../../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Show detailed bot statistics'),
    async execute(interaction) {
        const client = interaction.client;

        const totalGuilds = client.guilds.cache.size;
        const totalMembers = client.guilds.cache.reduce((a, b) => a + b.memberCount, 0);
        const uptime = formatUptime(client.uptime);
        const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

        // Count voice connections
        let connectedChannels = 0;
        client.guilds.cache.forEach(guild => {
            if (guild.members.me?.voice?.channel) connectedChannels++;
        });

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setAuthor({ name: `${client.user.username} — Statistics`, iconURL: client.user.displayAvatarURL() })
            .setThumbnail(client.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                {
                    name: '📊 General',
                    value: [
                        `**Servers:** ${totalGuilds}`,
                        `**Users:** ${totalMembers.toLocaleString()}`,
                        `**Channels:** ${client.channels.cache.size}`,
                        `**Voice Connections:** ${connectedChannels}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '⚙️ System',
                    value: [
                        `**Node.js:** ${process.version}`,
                        `**Discord.js:** v${djsVersion}`,
                        `**Memory:** ${memUsage} MB`,
                        `**Uptime:** ${uptime}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🎵 Music',
                    value: [
                        `**Lavalink:** Shoukaku`,
                        `**Active Players:** ${client.shoukaku?.players?.size || 0}`,
                        `**Commands:** ${client.commands.size}`
                    ].join('\n'),
                    inline: true
                }
            )
            .setFooter({ text: `Requested by ${interaction.user.tag}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};
