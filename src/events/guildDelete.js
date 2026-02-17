const { EmbedBuilder, Events } = require('discord.js');

module.exports = {
    name: Events.GuildDelete,
    async execute(guild) {
        const ownerId = process.env.OWNER_ID;
        if (!ownerId) return;

        try {
            const owner = await guild.client.users.fetch(ownerId);
            // On leave, we might not be able to fetch the owner if the bot is kicked, 
            // but we can try to get cached info or just display what we have.
            // guild.ownerId is available.

            let ownerTag = 'Unknown#0000';
            try {
                const guildOwner = await guild.client.users.fetch(guild.ownerId);
                ownerTag = guildOwner.tag;
            } catch (e) {
                // Owner might be unavailable or bot left
            }

            const embed = new EmbedBuilder()
                .setTitle('🍃 Left a Server')
                .setColor('Red')
                .addFields(
                    {
                        name: 'Guild Info',
                        value: `\`\`\`\n${guild.name} (${guild.id})\n\`\`\``
                    },
                    {
                        name: 'Owner Info',
                        value: `\`\`\`\n${ownerTag} (${guild.ownerId})\n\`\`\``
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
            console.error('Error sending guild leave DM:', error);
        }
    },
};
