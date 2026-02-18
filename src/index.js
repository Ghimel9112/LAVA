require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
client.queue = new Map();

// Lavalink Nodes
const Nodes = [{
    name: process.env.LAVA_NAME || 'LocalNode',
    url: process.env.LAVA_URL || 'localhost:2333',
    auth: process.env.LAVA_AUTH || 'youshallnotpass'
}];

// Shoukaku Options
const Options = {
    moveOnDisconnect: false,
    resume: false,
    resumeKey: 'YOUR_BOT_RESUME_KEY',
    voiceConnectionTimeout: 30,
    userAgent: "DiscordBot/1.0.0"
};

// Initialize Shoukaku
client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, Options);

client.shoukaku.on('error', (_, error) => console.error('Lavalink Error:', error));
client.shoukaku.on('close', (name) => console.warn(`Lavalink Node ${name} closed`));
client.shoukaku.on('disconnect', (name) => console.warn(`Lavalink Node ${name} disconnected`));
client.shoukaku.on('ready', (name) => console.log(`Lavalink Node ${name} is ready.`));
// client.shoukaku.on('debug', (_, info) => console.log(info)); // Uncomment for verbose debug logs

// Command Handler
const commandsPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPath);

for (const folder of commandFolders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            command.category = folder; // Set category from folder name
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

// Event Handler
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

client.login(process.env.TOKEN);
