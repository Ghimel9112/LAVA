const { Events, REST, Routes, ActivityType } = require('discord.js');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

        // Construct and prepare an instance of the REST module
        const rest = new REST().setToken(process.env.TOKEN);

        // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
        const commands = [];
        client.commands.forEach(cmd => {
            commands.push(cmd.data.toJSON());
        });

        // Deploy commands
        try {
            console.log(`Started refreshing ${commands.length} application (/) commands.`);

            // The put method is used to fully refresh all commands in the guild with the current set
            // For production, use Routes.applicationCommands(client.user.id) for global commands
            // Note: Global commands take up to an hour to propagate.
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );

            console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
        } catch (error) {
            console.error(error);
        }

        // Cycling status messages
        const statuses = [
            `Need help? Use: /help`,
            () => `${client.guilds.cache.reduce((a, b) => a + b.memberCount, 0)} Users!`,
            () => `${client.guilds.cache.size} Servers!`,
            `🚁 𝓐𝓽𝓪𝓬 𝓓𝓮 𝓔𝓵𝓲𝓬𝓸𝓹𝓽𝓮𝓻𝓮 🚁`,
            `Enjoy using this bot! :)`,
            `The bot is still in development!`,
            `lavabot.site`,
            `Lava Network`,
            `Want to test the premium features? use /requestpremium`,
        ];

        let statusIndex = 0;
        const updateStatus = () => {
            const status = statuses[statusIndex];
            const text = typeof status === 'function' ? status() : status;

            client.user.setPresence({
                activities: [{ name: text, type: ActivityType.Custom, state: text }],
                status: 'online',
            });

            statusIndex = (statusIndex + 1) % statuses.length;
        };

        updateStatus(); // Set the first status immediately
        setInterval(updateStatus, 15000); // Cycle every 15 seconds
    },
};
