const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaveserver')
        .setDescription('Force the bot to leave a specific server (Owner only).')
        .addStringOption(option =>
            option.setName('guild_id')
                .setDescription('The ID of the server to leave')
                .setRequired(true)),
    async execute(interaction) {
        const blacklist = require('../../utils/blacklist');
        const { EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

        // Owner Check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        const guildId = interaction.options.getString('guild_id');
        const guild = interaction.client.guilds.cache.get(guildId);

        if (!guild) {
            return interaction.reply({
                content: `I am not in a server with ID \`${guildId}\`.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            // 1. Blacklist the server
            blacklist.addBlacklist(guild.id);

            // 2. Try to send a message to the server
            // Find a suitable channel (System channel or first sendable text channel)
            let channel = guild.systemChannel;
            if (!channel) {
                channel = guild.channels.cache.find(c =>
                    c.type === ChannelType.GuildText &&
                    guild.members.me.permissionsIn(c).has(PermissionFlagsBits.SendMessages)
                );
            }

            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle('Bot Blacklist')
                    .setDescription('🚫 This server has been blacklisted from using this bot. I will now leave.')
                    .setColor('Red');
                await channel.send({ embeds: [embed] }).catch(() => null); // Ignore error if cannot send
            }

            // 3. Leave the server
            await guild.leave();

            await interaction.reply({
                content: `Successfully blacklisted and left **${guild.name}** (${guildId}).`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `Failed to leave server: ${error.message}`,
                flags: MessageFlags.Ephemeral
            });
        }
    },
};
