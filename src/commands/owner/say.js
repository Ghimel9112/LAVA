const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message as the bot (owner only)')
        .addStringOption(opt =>
            opt.setName('message')
                .setDescription('The message to send')
                .setRequired(true)
                .setMaxLength(2000))
        .addChannelOption(opt =>
            opt.setName('channel')
                .setDescription('Channel to send the message in (defaults to current channel)')
                .setRequired(false)),

    async execute(interaction) {
        // Owner-only check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({
                content: '❌ This command is restricted to the bot owner.',
                flags: MessageFlags.Ephemeral
            });
        }

        const message = interaction.options.getString('message');
        const targetChannel = interaction.options.getChannel('channel') ?? interaction.channel;

        // Make sure the bot can send messages in the target channel
        if (!targetChannel.isTextBased()) {
            return interaction.reply({
                content: '❌ That channel is not a text-based channel.',
                flags: MessageFlags.Ephemeral
            });
        }

        const botMember = interaction.guild?.members?.me;
        if (botMember && !targetChannel.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages)) {
            return interaction.reply({
                content: `❌ I don't have permission to send messages in ${targetChannel}.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await targetChannel.send(message);

            const confirmEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setDescription(`✅ Message sent in ${targetChannel}.`);

            return interaction.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('[SAY] Failed to send message:', error);
            return interaction.reply({
                content: `❌ Failed to send message: \`${error.message}\``,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
