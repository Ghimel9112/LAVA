const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Select a member and ban them.')
        .addUserOption(option =>
            option
                .setName('target')
                .setDescription('The member to ban')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    async execute(interaction) {
        const target = interaction.options.getUser('target');
        const member = interaction.guild.members.cache.get(target.id);

        if (member && !member.bannable) {
            return interaction.reply({ content: 'I cannot ban this user. They may have higher roles than me.', flags: MessageFlags.Ephemeral });
        }

        await interaction.guild.members.ban(target);
        await interaction.reply({ content: `Banned ${target.username}.` });
    },
};
