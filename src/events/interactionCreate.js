const { Events, EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../utils/db');

function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Handle Chat Input Commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error(error);
                // Check if the interaction is still valid before trying to respond
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: 'There was an error executing this command!', flags: MessageFlags.Ephemeral });
                    } else {
                        await interaction.reply({ content: 'There was an error executing this command!', flags: MessageFlags.Ephemeral });
                    }
                } catch (handlerError) {
                    // If we can't notify the user, just log it. This prevents the "Unknown interaction" crash loops.
                    console.error('Error handling logic failed:', handlerError);
                }
            }
        }

        // Handle Select Menu (Queue Management)
        else if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'queue_select') {
                const queue = interaction.client.queue.get(interaction.guild.id);
                if (!queue || !queue.songs.length) {
                    return interaction.reply({ content: 'The queue is no longer active.', flags: MessageFlags.Ephemeral });
                }

                const selectedIndex = parseInt(interaction.values[0]);
                const track = queue.songs[selectedIndex];

                if (!track) {
                    return interaction.reply({ content: 'That song is no longer in the queue.', flags: MessageFlags.Ephemeral });
                }

                const embed = new EmbedBuilder()
                    .setColor('Blurple')
                    .setTitle('🎵 Selected Song')
                    .setDescription(`**${truncate(track.info.title, 60)}**\nby ${track.info.author}\n\nPosition in queue: **#${selectedIndex}**`)
                    .setFooter({ text: 'Choose an action below' });

                if (track.info.artworkUrl) embed.setThumbnail(track.info.artworkUrl);

                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`queue_move_${selectedIndex}`)
                        .setLabel('Move to Front')
                        .setEmoji('🔝')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`queue_delete_${selectedIndex}`)
                        .setLabel('Delete')
                        .setEmoji('🗑️')
                        .setStyle(ButtonStyle.Danger)
                );

                await interaction.reply({ embeds: [embed], components: [actionRow], flags: MessageFlags.Ephemeral });
            }
        }

        // Handle Buttons
        else if (interaction.isButton()) {
            const { customId } = interaction;

            // --- Queue Move to Front ---
            if (customId.startsWith('queue_move_')) {
                const index = parseInt(customId.split('_')[2]);
                const queue = interaction.client.queue.get(interaction.guild.id);

                if (!queue || !queue.songs.length) {
                    return interaction.reply({ content: 'The queue is no longer active.', flags: MessageFlags.Ephemeral });
                }

                if (index < 1 || index >= queue.songs.length) {
                    return interaction.reply({ content: 'That song is no longer in the queue at that position.', flags: MessageFlags.Ephemeral });
                }

                const [movedTrack] = queue.songs.splice(index, 1);
                queue.songs.splice(1, 0, movedTrack); // Insert right after the currently playing track

                const embed = new EmbedBuilder()
                    .setColor('Green')
                    .setDescription(`🔝 **${truncate(movedTrack.info.title, 60)}** has been moved to **next up** in the queue!`);

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }

            // --- Queue Delete ---
            if (customId.startsWith('queue_delete_')) {
                const index = parseInt(customId.split('_')[2]);
                const queue = interaction.client.queue.get(interaction.guild.id);

                if (!queue || !queue.songs.length) {
                    return interaction.reply({ content: 'The queue is no longer active.', flags: MessageFlags.Ephemeral });
                }

                if (index < 1 || index >= queue.songs.length) {
                    return interaction.reply({ content: 'That song is no longer in the queue at that position.', flags: MessageFlags.Ephemeral });
                }

                const [removedTrack] = queue.songs.splice(index, 1);

                const embed = new EmbedBuilder()
                    .setColor('Red')
                    .setDescription(`🗑️ **${truncate(removedTrack.info.title, 60)}** has been removed from the queue.`);

                await interaction.update({ embeds: [embed], components: [] });
                return;
            }

            // --- Premium Request Buttons ---
            const parts = customId.split('_');
            const action = parts[0];
            const guildId = parts[1];
            const requesterId = parts[2];

            if (action === 'accept' || action === 'reject') {
                // Ensure only owner can click these (though it's in their DM, safety check)
                if (interaction.user.id !== process.env.OWNER_ID) {
                    return interaction.reply({ content: 'You are not authorized to use this button.', flags: MessageFlags.Ephemeral });
                }

                if (action === 'accept') {
                    db.addPremium(guildId);
                    db.removeRequest(guildId);
                    const embed = new EmbedBuilder()
                        .setColor('Green')
                        .setTitle('Premium Request Accepted')
                        .setDescription(`Guild ID: ${guildId} has been granted premium access.`);

                    await interaction.update({ embeds: [embed], components: [] });

                    // Notify the requester
                    try {
                        const requester = await interaction.client.users.fetch(requesterId);
                        const guild = await interaction.client.guilds.fetch(guildId);
                        const notifyEmbed = new EmbedBuilder()
                            .setColor('Green')
                            .setTitle('✅ Premium Request Accepted!')
                            .setDescription(`Your premium request for **${guild.name}** has been accepted!\n\nYour server now has premium access.`)
                            .setTimestamp();
                        await requester.send({ embeds: [notifyEmbed] });
                    } catch (err) {
                        console.error('Failed to notify requester:', err);
                    }
                } else if (action === 'reject') {
                    db.removeRequest(guildId);
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setTitle('Premium Request Rejected')
                        .setDescription(`Guild ID: ${guildId} has been denied premium access.`);

                    await interaction.update({ embeds: [embed], components: [] });

                    // Notify the requester
                    try {
                        const requester = await interaction.client.users.fetch(requesterId);
                        const guild = await interaction.client.guilds.fetch(guildId);
                        const notifyEmbed = new EmbedBuilder()
                            .setColor('Red')
                            .setTitle('❌ Premium Request Rejected')
                            .setDescription(`Your premium request for **${guild.name}** has been rejected.`)
                            .setTimestamp();
                        await requester.send({ embeds: [notifyEmbed] });
                    } catch (err) {
                        console.error('Failed to notify requester:', err);
                    }
                }
            }
        }
    },
};
