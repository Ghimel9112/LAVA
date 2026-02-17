const { EmbedBuilder, Events } = require('discord.js');

module.exports = {
    name: Events.GuildCreate,
    async execute(guild) {
        const blacklist = require('../utils/blacklist');
        if (blacklist.isBlacklisted(guild.id)) {
            try {
                const ownerId = process.env.OWNER_ID;
                if (ownerId) {
                    const owner = await guild.client.users.fetch(ownerId);
                    await owner.send(`⚠️ **Auto-left Blacklisted Server**\nName: ${guild.name}\nID: ${guild.id}`);
                }
                await guild.leave();
            } catch (err) {
                console.error('Error handling blacklisted guild join:', err);
            }
            return; // Stop execution
        }

        const ownerId = process.env.OWNER_ID;
        if (!ownerId) return;

        try {
            const owner = await guild.client.users.fetch(ownerId);
            const guildOwner = await guild.fetchOwner();

            const embed = new EmbedBuilder()
                .setTitle(':Join_vc: Joined a New Server')
                .setColor('Green') // Matches the green line on the left
                .addFields(
                    {
                        name: 'Guild Info',
                        value: `\`\`\`\n${guild.name} (${guild.id})\n\`\`\``
                    },
                    {
                        name: 'Owner Info',
                        value: `\`\`\`\n${guildOwner.user.tag} (${guildOwner.id})\n\`\`\``
                    },
                    {
                        name: 'Member Count',
                        value: `\`\`\`\n${guild.memberCount}\n\`\`\``
                    },
                    {
                        name: 'Servers Bot is in',
                        value: `\`\`\`\n${guild.client.guilds.cache.size}\n\`\`\``
                    },
                    {
                        name: 'Leave Server:',
                        value: `\`\`\`\n/leaveserver ${guild.id}\n\`\`\``
                    }
                )
                .setThumbnail(guild.iconURL({ dynamic: true }));

            await owner.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending guild join DM:', error);
        }
    },
};
