'use strict';

const fs = require('fs');
const path = require('path');
const BASE_URL = process.env.LAVA_API_BASE || 'https://lavabot.site';
const TIMEOUT_MS = 8000;
const PER_GUILD_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Build the shared auth headers.  Never log the secret value.
 */
function authHeaders() {
    return {
        'Authorization': `Bearer ${process.env.LAVA_BOT_SECRET}`,
        'Content-Type': 'application/json',
    };
}

/**
 * Fetch with an AbortController timeout.
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: authHeaders(),
            signal: controller.signal,
        });
        return res;
    } finally {
        clearTimeout(timer);
    }
}



// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const premiumService = {
    /** @type {Set<string>} */
    premiumGuilds: new Set(),

    /** Per-guild cache: Map<guildId, { value: boolean, expiresAt: number }> */
    _perGuildCache: new Map(),

    /**
     * Fetch the full premium list from the website, overwrite the local JSON
     * file atomically, and refresh the in-memory set.
     * On any network / parse error, logs a warning and keeps the existing cache.
     */
    async syncAll() {
        try {
            const res = await fetchWithTimeout(`${BASE_URL}/api/public/premium`);

            if (!res.ok) {
                console.warn(`[PremiumService] syncAll failed — HTTP ${res.status}`);
                return;
            }

            const data = await res.json();
            const guilds = Array.isArray(data.guilds) ? data.guilds.map(String) : [];

            this.premiumGuilds = new Set(guilds);
            // Invalidate per-guild cache so next call re-fetches fresh data
            this._perGuildCache.clear();

            const dbPath = path.join(__dirname, '..', 'premium_guilds.json');
            const tmpPath = dbPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(guilds, null, 2));
            fs.renameSync(tmpPath, dbPath);

            console.log(`[PremiumService] Synced ${guilds.length} premium guild(s) from ${data.environment || 'unknown'} environment.`);
        } catch (err) {
            console.warn('[PremiumService] syncAll error — keeping last known cache:', err.message);
        }
    },

    /**
     * Check whether a guild is premium.
     * 1. Check in-memory set first (O(1)).
     * 2. On a miss, check the per-guild TTL cache.
     * 3. On a cache miss / expiry, fetch from the API and cache for 60 s.
     * Never throws; falls back to the last known state on error.
     * @param {string} guildId
     * @returns {Promise<boolean>}
     */
    async isPremium(guildId) {
        const id = String(guildId);

        // Fast path: in-memory set (populated by syncAll)
        if (this.premiumGuilds.has(id)) return true;

        // Per-guild TTL cache (covers guilds activated between full syncs)
        const cached = this._perGuildCache.get(id);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }

        // Network fetch
        try {
            const res = await fetchWithTimeout(`${BASE_URL}/api/public/premium/${id}`);

            if (!res.ok) {
                console.warn(`[PremiumService] isPremium(${id}) failed — HTTP ${res.status}`);
                return cached ? cached.value : false;
            }

            const data = await res.json();
            const value = Boolean(data.active);

            this._perGuildCache.set(id, { value, expiresAt: Date.now() + PER_GUILD_TTL_MS });

            // Sync in-memory set if the API says it's active
            if (value) this.premiumGuilds.add(id);

            return value;
        } catch (err) {
            console.warn(`[PremiumService] isPremium(${id}) error — using cached value:`, err.message);
            return cached ? cached.value : false;
        }
    },

    /**
     * Fetch the full premium data for a specific guild from the website.
     * @param {string} guildId
     * @returns {Promise<Object|null>}
     */
    async getPremiumInfo(guildId) {
        const id = String(guildId);
        try {
            const res = await fetchWithTimeout(`${BASE_URL}/api/public/premium/${id}`);
            if (!res.ok) {
                return null;
            }
            return await res.json();
        } catch (err) {
            console.warn(`[PremiumService] getPremiumInfo(${id}) error:`, err.message);
            return null;
        }
    },
};

module.exports = premiumService;
