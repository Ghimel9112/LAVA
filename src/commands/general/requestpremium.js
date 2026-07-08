const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../../utils/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('requestpremium')
        .setDescription('Request premium status for this server.'),
    async execute(interaction) {
        if (db.isPremium(interaction.guild.id)) {
            return interaction.reply({ content: 'This server is already Premium!', flags: MessageFlags.Ephemeral });
        }

        if (db.hasPendingRequest(interaction.guild.id)) {
            return interaction.reply({ content: '⏳ This server already has a pending premium request. Please wait for the owner to respond.', flags: MessageFlags.Ephemeral });
        }

        const ownerId = process.env.OWNER_ID;
        if (!ownerId) {
            return interaction.reply({ content: 'Owner ID is not configured. Cannot make request.', flags: MessageFlags.Ephemeral });
        }

        // Create buttons (include requester ID for notification)
        const acceptButton = new ButtonBuilder()
            .setCustomId(`accept_${interaction.guild.id}_${interaction.user.id}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`reject_${interaction.guild.id}_${interaction.user.id}`)
            .setLabel('Reject')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder()
            .addComponents(acceptButton, rejectButton);

        const embed = new EmbedBuilder()
            .setTitle('Premium Request')
            .setDescription(`Server **${interaction.guild.name}** (${interaction.guild.id}) requested premium.\nRequested by: ${interaction.user.tag}`)
            .setColor('Blue')
            .setTimestamp();

        try {
            const owner = await interaction.client.users.fetch(ownerId);
            await owner.send({ embeds: [embed], components: [row] });
            db.addRequest(interaction.guild.id);
            await interaction.reply({ content: 'Premium request sent to the bot owner!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error(error);
            await interaction.reply({ content: 'Failed to send request (Owner might have DMs closed or ID is invalid).', flags: MessageFlags.Ephemeral });
        }
    },
};
