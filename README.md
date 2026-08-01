# LAVA — Discord Music Bot

A feature-rich Discord music bot powered by **Lavalink** and **Shoukaku**, with premium features unlocked via [lavabot.site](https://lavabot.site).

Hosted on a Google Cloud VM.

---

## Setup (Production / Google Cloud VM)

1. Clone the repository to your VM.
2. Copy `.env.example` to `.env` and fill in all values (see below).
3. Run `npm install`.
4. Start Lavalink, then start the bot using `node start.js` or your process manager of choice (PM2, systemd, etc.).

### Lavalink on a VM

Ensure Java is installed on the VM:

```bash
java -jar lavalink/Lavalink.jar
```

Verify Lavalink is reachable on port `2333` before starting the bot.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TOKEN` | ✅ | — | Discord bot token |
| `CLIENT_ID` | ✅ | — | Discord application client ID |
| `OWNER_ID` | ✅ | — | Your Discord user ID (owner-only commands) |
| `LAVA_BOT_SECRET` | ✅ | — | Shared secret for lavabot.site API (see below) |
| `LAVA_API_BASE` | ❌ | `https://lavabot.site` | Override the premium API base URL |
| `LAVA_NAME` | ❌ | `LocalNode` | Lavalink node name |
| `LAVA_URL` | ❌ | `localhost:2333` | Lavalink node URL |
| `LAVA_AUTH` | ❌ | `youshallnotpass` | Lavalink node password |
| `GUILD_ID` | ❌ | — | Guild ID for instant command registration during development |
| `BUG_REPORT_CHANNEL_ID` | ❌ | — | Discord channel ID for bug reports |

---

## Process Management

For production on a Google Cloud VM, use PM2 or systemd instead of `start.bat` or `start.js` directly.

Example with PM2:

```bash
pm2 start start.js --name lavabot
pm2 save
pm2 startup
```

---

## Premium Sync

Premium status is managed via [lavabot.site](https://lavabot.site) and kept in sync with the bot automatically.

### How It Works

1. On startup, the bot calls `GET /api/public/premium` and loads all active premium guild IDs into an in-memory `Set`.
2. Every **5 minutes**, it repeats this sync to pick up any new purchases or cancellations without requiring a restart.
3. Per-guild lookups (e.g. for guilds activated between full syncs) are cached for **60 seconds** to avoid hammering the API.
4. The result is also written atomically to `premium_guilds.json` as a local fallback.

### Required `.env` additions

```env
# Secret shared with lavabot.site. Passed as a Bearer token in the Authorization header.
LAVA_BOT_SECRET=your_secret_here

# Optional: override the API base (useful for staging)
# LAVA_API_BASE=https://lavabot.site
```

### Owner Commands

| Command | Description |
|---|---|
| `/premium refresh` | Force an immediate full sync and report the cached count |

### User Commands

| Command | Description |
|---|---|
| `/premium status [guild_id]` | Show the premium status of a guild (defaults to the current server), including subscription end date |
| `/premium manage` | Link to the Stripe customer portal on lavabot.site to manage your subscription |

### Premium-Gated Features

| Command / Feature | Description |
|---|---|
| `/247` | Keep the bot in a voice channel 24/7 |
| `/savedqueue` | Save, load, and manage custom queues |
| `/filter` | Apply advanced audio filters (bassboost, nightcore, 3D, speed, pitch) |
| `/play` | Direct YouTube source access (non-premium uses Apple Music safe mode) |
| `/search` | YouTube search (non-premium uses Apple Music) |
| `/autoplay` | AI-driven autoplay using YouTube recommendations |

---

## Running Tests

```bash
npm install          # installs Jest as a devDependency
npm test             # runs tests/premiumService.test.js
```

Tests cover: successful sync, HTTP error fallback, network error fallback, per-guild 60s TTL cache, cache expiry re-fetch, and stale-cache error fallback.
