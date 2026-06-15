const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const LAVA_PORT = 2333;
const LAVA_DIR = path.join(__dirname, 'lavalink');
const LAVA_JAR = 'Lavalink.jar';

// Colors for console output
const c = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(prefix, color, msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`${color}[${time}] [${prefix}]${c.reset} ${msg}`);
}

// Check if a port is open (Lavalink ready)
function waitForPort(port, host = '127.0.0.1', timeout = 300000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        function tryConnect() {
            const sock = new net.Socket();
            sock.setTimeout(1000);

            sock.once('connect', () => {
                sock.destroy();
                resolve();
            });

            sock.once('error', () => {
                sock.destroy();
                if (Date.now() - start >= timeout) {
                    reject(new Error(`Timed out waiting for port ${port} after ${timeout / 1000}s`));
                } else {
                    setTimeout(tryConnect, 1000);
                }
            });

            sock.once('timeout', () => {
                sock.destroy();
                setTimeout(tryConnect, 1000);
            });

            sock.connect(port, host);
        }

        tryConnect();
    });
}

async function start() {
    console.log(`\n${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
    console.log(`${c.bold}${c.cyan}        Discord Bot Launcher${c.reset}`);
    console.log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}\n`);

    // 1. (Skipped) Using Lavalink OAuth instead of poToken generation
    log('Startup', c.green, 'Using OAuth2 authentication to bypass YouTube bot detection.');

    // 2. Start Lavalink
    log('Lavalink', c.yellow, 'Starting Lavalink server...');

    const lavalink = spawn('java', ['-jar', LAVA_JAR], {
        cwd: LAVA_DIR,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    lavalink.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) log('Lavalink', c.yellow, line);
    });

    lavalink.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) log('Lavalink', c.red, line);
    });

    lavalink.on('exit', (code) => {
        log('Lavalink', c.red, `Lavalink process exited with code ${code}`);
        if (code !== 0 && code !== null) process.exit(1);
    });

    // 3. Wait for Lavalink to be ready
    log('Lavalink', c.yellow, `Waiting for Lavalink on port ${LAVA_PORT}...`);

    try {
        await waitForPort(LAVA_PORT);
        log('Lavalink', c.green, 'Lavalink is ready! ✓');
    } catch (err) {
        log('Lavalink', c.red, err.message);
        lavalink.kill();
        process.exit(1);
    }

    // 4. Start the bot
    log('Bot', c.cyan, 'Starting Discord bot...');

    const bot = spawn('node', ['src/index.js'], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
    });

    bot.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) log('Bot', c.cyan, line);
    });

    bot.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) log('Bot', c.red, line);
    });

    bot.on('exit', (code) => {
        log('Bot', c.red, `Bot process exited with code ${code}`);
        lavalink.kill();
        process.exit(code || 0);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log(`\n${c.yellow}Shutting down...${c.reset}`);
        bot.kill();
        lavalink.kill();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        bot.kill();
        lavalink.kill();
        process.exit(0);
    });
}

start();
