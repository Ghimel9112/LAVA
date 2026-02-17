require('dotenv').config();
const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');

const commands = [];

// Grab all command folders from the commands directory
const commandsPath = path.join(__dirname, 'src', 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
            commands.push(command.data.toJSON());
            console.log(`✓ Loaded command: ${command.data.name}`);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(process.env.TOKEN);

// Deploy commands
(async () => {
    try {
        console.log(`\nStarted refreshing ${commands.length} application (/) commands.`);

        const guildId = process.env.GUILD_ID;

        if (guildId) {
            // Register commands to specific guild (instant)
            const data = await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                { body: commands },
            );

            console.log(`\n✓ Successfully reloaded ${data.length} guild commands (instant).`);
            console.log(`✓ Registered to guild: ${guildId}`);
        } else {
            // Register commands globally (takes up to 1 hour to propagate)
            const data = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands },
            );

            console.log(`\n✓ Successfully reloaded ${data.length} global commands (may take up to 1 hour).`);
        }

        console.log('\nCommands registered:');
        commands.forEach(cmd => console.log(`  - /${cmd.name}`));

    } catch (error) {
        console.error('Error deploying commands:', error);
    }
})();
