const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        const queue = oldState.client.queue.get(oldState.guild.id);
        if (!queue || !queue.player) return;

        // Get the bot's current voice channel using Discord.js (reliable)
        const botVoiceChannel = oldState.guild.members.me?.voice?.channelId;
        if (!botVoiceChannel) return;

        // If the event didn't happen in the bot's channel, ignore
        if (oldState.channelId !== botVoiceChannel && newState.channelId !== botVoiceChannel) return;

        // Get the voice channel object
        const channel = oldState.guild.channels.cache.get(botVoiceChannel);
        if (!channel) return;

        // Count human members in the channel
        const humanMembers = channel.members.filter(member => !member.user.bot);

        if (humanMembers.size === 0) {
            // If 24/7 mode is enabled, stay in the channel
            if (queue.twentyFourSeven) return;

            // Channel is empty (except for bots)
            console.log(`Voice channel empty in ${oldState.guild.name}. Disconnecting...`);

            try {
                // 1. Delete the "Now Playing" message
                if (queue.lastMessage) {
                    try {
                        await queue.lastMessage.delete();
                    } catch (err) {
                        console.error('Failed to delete last message:', err);
                    }
                }

                // 2. Send Goodbye Message
                if (queue.textChannel) {
                    const embed = new EmbedBuilder()
                        .setColor('Red')
                        .setDescription("I left the voice channel because I was left alone :(");

                    await queue.textChannel.send({ embeds: [embed] });
                }

                // 3. Disconnect and Cleanup
                if (queue.player) queue.player.stopTrack();
                await oldState.client.shoukaku.leaveVoiceChannel(oldState.guild.id);
                oldState.client.queue.delete(oldState.guild.id);

            } catch (error) {
                console.error('Error during auto-disconnect:', error);
            }
        }
    },
};
