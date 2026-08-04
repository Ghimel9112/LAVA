'use strict';

/**
 * Cache Store — In-Memory Cache with JSON File Persistence
 * 
 * A lightweight, zero-dependency cache that stores everything in memory
 * and persists to a JSON file on shutdown. On next startup, it loads
 * the persisted data back into memory.
 * 
 * This replaces Redis for bots that don't need/want an external service.
 * The API is async (returns Promises) so it can be swapped for Redis later
 * without changing any calling code.
 * 
 * Features:
 *   - Key-value storage with optional TTL (auto-expiry)
 *   - List operations (lpush, lrange, ltrim) for rolling history
 *   - Automatic JSON file save on process exit (SIGINT, SIGTERM)
 *   - Load from JSON file on init
 *   - No external dependencies
 * 
 * Storage file: src/data/cache_store.json
 */

const fs = require('fs');
const path = require('path');

// Default location for the persisted JSON file
const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'cache_store.json');

// ---------------------------------------------------------------------------
// In-Memory Store
// ---------------------------------------------------------------------------

class CacheStore {
    constructor() {
        /** @type {Map<string, { value: string, expiresAt: number|null }>} */
        this._data = new Map();

        /** @type {Map<string, string[]>} */
        this._lists = new Map();

        /** Whether shutdown hooks have been registered */
        this._hooksRegistered = false;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    /**
     * Initialize the cache store: load persisted data from disk,
     * register shutdown hooks for auto-save.
     * Safe to call multiple times (idempotent).
     */
    async connect() {
        this._loadFromDisk();
        this._registerShutdownHooks();
        console.log(`[CacheStore] Initialized (in-memory + JSON file backup at ${STORE_FILE})`);
    }

    /**
     * Save data to disk and clear memory. Called on shutdown.
     */
    async disconnect() {
        this._saveToDisk();
        this._data.clear();
        this._lists.clear();
        console.log('[CacheStore] Saved and disconnected.');
    }

    // ── Key-Value Operations ─────────────────────────────────────────────

    /**
     * Get a value by key. Returns null if expired or missing.
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async get(key) {
        const entry = this._data.get(key);
        if (!entry) return null;

        // Check TTL expiry
        if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
            this._data.delete(key);
            return null;
        }

        return entry.value;
    }

    /**
     * Set a value with optional TTL.
     * @param {string} key
     * @param {string} value
     * @param {number} [ttlSeconds] — Time-to-live in seconds. Omit for no expiry.
     */
    async set(key, value, ttlSeconds) {
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
        this._data.set(key, { value, expiresAt });
    }

    /**
     * Delete a key (both key-value and list).
     * @param {string} key
     */
    async del(key) {
        this._data.delete(key);
        this._lists.delete(key);
    }

    // ── List Operations (for rolling history) ────────────────────────────

    /**
     * Prepend values to a list (newest first, like Redis LPUSH).
     * @param {string} key
     * @param {...string} values
     * @returns {Promise<number>} New list length
     */
    async lpush(key, ...values) {
        const list = this._lists.get(key) || [];
        list.unshift(...values);
        this._lists.set(key, list);
        return list.length;
    }

    /**
     * Get a range from a list (like Redis LRANGE).
     * @param {string} key
     * @param {number} start — Start index (0-based)
     * @param {number} stop — End index (-1 means "to end", inclusive)
     * @returns {Promise<string[]>}
     */
    async lrange(key, start, stop) {
        const list = this._lists.get(key) || [];
        const end = stop === -1 ? list.length : stop + 1;
        return list.slice(start, end);
    }

    /**
     * Trim a list to the specified range (like Redis LTRIM).
     * @param {string} key
     * @param {number} start
     * @param {number} stop — -1 means "to end"
     */
    async ltrim(key, start, stop) {
        const list = this._lists.get(key) || [];
        const end = stop === -1 ? list.length : stop + 1;
        this._lists.set(key, list.slice(start, end));
    }

    // ── Persistence ──────────────────────────────────────────────────────

    /**
     * Load cached data from the JSON file on disk.
     * Silently ignores missing or corrupt files.
     */
    _loadFromDisk() {
        try {
            if (!fs.existsSync(STORE_FILE)) return;

            const raw = fs.readFileSync(STORE_FILE, 'utf8');
            const data = JSON.parse(raw);

            // Restore key-value entries (skip expired ones)
            if (data.kv && typeof data.kv === 'object') {
                const now = Date.now();
                for (const [key, entry] of Object.entries(data.kv)) {
                    if (entry.expiresAt === null || entry.expiresAt > now) {
                        this._data.set(key, entry);
                    }
                }
            }

            // Restore lists
            if (data.lists && typeof data.lists === 'object') {
                for (const [key, list] of Object.entries(data.lists)) {
                    if (Array.isArray(list)) {
                        this._lists.set(key, list);
                    }
                }
            }

            console.log(`[CacheStore] Loaded ${this._data.size} keys + ${this._lists.size} lists from disk.`);
        } catch (err) {
            console.warn(`[CacheStore] Failed to load from disk: ${err.message} — starting fresh.`);
        }
    }

    /**
     * Save all in-memory data to the JSON file.
     * Creates the data directory if it doesn't exist.
     * Uses atomic write (temp file + rename) to prevent corruption.
     */
    _saveToDisk() {
        try {
            // Ensure data directory exists
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }

            // Convert Maps to plain objects for JSON serialization
            const kv = {};
            for (const [key, entry] of this._data) {
                kv[key] = entry;
            }

            const lists = {};
            for (const [key, list] of this._lists) {
                lists[key] = list;
            }

            const json = JSON.stringify({ kv, lists }, null, 2);

            // Atomic write: write to temp file, then rename
            const tmpFile = STORE_FILE + '.tmp';
            fs.writeFileSync(tmpFile, json, 'utf8');
            fs.renameSync(tmpFile, STORE_FILE);

            console.log(`[CacheStore] Saved ${this._data.size} keys + ${this._lists.size} lists to disk.`);
        } catch (err) {
            console.error(`[CacheStore] Failed to save to disk: ${err.message}`);
        }
    }

    /**
     * Register process shutdown hooks to auto-save on exit.
     * Only registers once even if called multiple times.
     */
    _registerShutdownHooks() {
        if (this._hooksRegistered) return;
        this._hooksRegistered = true;

        const save = () => {
            this._saveToDisk();
        };

        process.on('SIGINT', save);
        process.on('SIGTERM', save);
        process.on('beforeExit', save);
    }
}

// Singleton instance
const cacheStore = new CacheStore();

module.exports = cacheStore;
