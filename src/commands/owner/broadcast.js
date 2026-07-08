const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('broadcast')
        .setDescription('Send a message to one channel in every server (Owner only)')
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('The message to broadcast')
                .setRequired(true)
                .setMaxLength(2000)),

    async execute(interaction) {
        // Owner-only check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: '❌ This command is restricted to the bot owner.',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const message = interaction.options.getString('message');
        const guilds = interaction.client.guilds.cache;

        let success = 0;
        let failed = 0;
        const failedGuilds = [];

        for (const [, guild] of guilds) {
            try {
                // Try system channel first, then fall back to first sendable text channel
                let channel = guild.systemChannel;

                if (!channel || !channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
                    channel = guild.channels.cache.find(c =>
                        c.type === ChannelType.GuildText &&
                        c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
                    );
                }

                if (!channel) {
                    failed++;
                    failedGuilds.push(`${guild.name} (no sendable channel)`);
                    continue;
                }

                await channel.send(message);
                success++;
            } catch (error) {
                failed++;
                failedGuilds.push(`${guild.name} (${error.message})`);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('📡 Broadcast Complete')
            .setColor(failed === 0 ? 0x57F287 : 0xFEE75C)
            .addFields(
                { name: '✅ Sent', value: `${success}`, inline: true },
                { name: '❌ Failed', value: `${failed}`, inline: true },
                { name: '📊 Total Servers', value: `${guilds.size}`, inline: true }
            )
            .setTimestamp();

        if (failedGuilds.length > 0) {
            const failList = failedGuilds.slice(0, 10).join('\n');
            const extra = failedGuilds.length > 10 ? `\n...and ${failedGuilds.length - 10} more` : '';
            embed.addFields({ name: 'Failed Servers', value: failList + extra });
        }

        return interaction.editReply({ embeds: [embed] });
    }
};
