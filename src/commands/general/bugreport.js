const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bugreport')
        .setDescription('Report a bug to the bot developer')
        .addStringOption(opt =>
            opt.setName('description')
                .setDescription('Describe the bug in detail')
                .setRequired(true))
        .addStringOption(opt =>
            opt.setName('steps')
                .setDescription('Steps to reproduce the bug')
                .setRequired(false))
        .addStringOption(opt =>
            opt.setName('expected')
                .setDescription('What you expected to happen')
                .setRequired(false)),
    async execute(interaction) {
        const ownerId = process.env.OWNER_ID;
        if (!ownerId) {
            return interaction.reply({ content: '❌ Owner ID is not configured. Cannot send report.', flags: MessageFlags.Ephemeral });
        }

        const description = interaction.options.getString('description');
        const steps = interaction.options.getString('steps');
        const expected = interaction.options.getString('expected');

        const embed = new EmbedBuilder()
            .setColor('Red')
            .setTitle('🐛 Bug Report')
            .addFields(
                { name: '📝 Description', value: description },
                { name: '👤 Reporter', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                { name: '🏠 Server', value: `${interaction.guild.name} (\`${interaction.guild.id}\`)`, inline: true },
                { name: '📢 Channel', value: `#${interaction.channel.name}`, inline: true }
            )
            .setTimestamp();

        if (steps) embed.addFields({ name: '🔄 Steps to Reproduce', value: steps });
        if (expected) embed.addFields({ name: '✅ Expected Behavior', value: expected });

        try {
            const owner = await interaction.client.users.fetch(ownerId);
            await owner.send({ embeds: [embed] });

            const confirmEmbed = new EmbedBuilder()
                .setColor('Green')
                .setDescription('✅ Bug report sent to the developer. Thank you!');
            await interaction.reply({ embeds: [confirmEmbed], flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Bug report send error:', error);
            await interaction.reply({ content: '❌ Failed to send bug report (Developer DMs may be closed).', flags: MessageFlags.Ephemeral });
        }
    },
};
