const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('eval')
        .setDescription('Execute JavaScript code (owner only)')
        .addStringOption(opt =>
            opt.setName('code')
                .setDescription('Code to evaluate')
                .setRequired(true)),
    async execute(interaction) {
        // Owner-only check
        if (interaction.user.id !== process.env.OWNER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot owner.', ephemeral: true });
        }

        const code = interaction.options.getString('code');
        await interaction.deferReply({ ephemeral: true });

        try {
            const client = interaction.client; // Available in eval scope
            let result = eval(code);

            // Handle promises
            if (result instanceof Promise) result = await result;

            // Convert to string
            let output = typeof result === 'string' ? result : require('util').inspect(result, { depth: 2 });

            // Truncate long output
            if (output.length > 4000) output = output.substring(0, 4000) + '\n... (truncated)';

            const embed = new EmbedBuilder()
                .setColor('Green')
                .setTitle('✅ Eval Result')
                .addFields(
                    { name: '📥 Input', value: `\`\`\`js\n${code.substring(0, 1000)}\`\`\`` },
                    { name: '📤 Output', value: `\`\`\`js\n${output}\`\`\`` }
                );
            return interaction.editReply({ embeds: [embed] });
        } catch (e) {
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setTitle('❌ Eval Error')
                .addFields(
                    { name: '📥 Input', value: `\`\`\`js\n${code.substring(0, 1000)}\`\`\`` },
                    { name: '❌ Error', value: `\`\`\`js\n${String(e.message || e).substring(0, 4000)}\`\`\`` }
                );
            return interaction.editReply({ embeds: [embed] });
        }
    }
};
