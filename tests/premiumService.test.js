'use strict';

/**
 * Tests for src/services/premiumService.js
 *
 * Run with:  npx jest tests/premiumService.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal fetch mock that resolves with the given body / status. */
function mockFetch(body, status = 200) {
    return jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: jest.fn().mockResolvedValue(body),
    });
}

/** Build a fetch mock that rejects (network error). */
function failingFetch(message = 'Network error') {
    return jest.fn().mockRejectedValue(new Error(message));
}

// ── Test setup ─────────────────────────────────────────────────────────────

let tmpDir;
let dbPath;
let originalEnv;

beforeEach(() => {
    // Isolate each test with a fresh temp directory so JSON writes don't collide
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lava-test-'));
    dbPath = path.join(tmpDir, 'premium_guilds.json');

    // Write an initial "database"
    fs.writeFileSync(dbPath, JSON.stringify(['111', '222'], null, 2));

    // Patch env
    originalEnv = { ...process.env };
    process.env.LAVA_BOT_SECRET = 'test-secret';
    process.env.LAVA_API_BASE = 'https://lavabot.site';

    // Re-require the module fresh for every test
    jest.resetModules();

    // Patch the DB_PATH used inside the service by overriding the path constant.
    // We do this by mocking the 'path' module so __dirname-based resolution returns our tmp file.
    jest.doMock('path', () => {
        const realPath = jest.requireActual('path');
        return {
            ...realPath,
            join: (...args) => {
                const joined = realPath.join(...args);
                // Only redirect the DB path; leave everything else alone
                if (joined.endsWith('premium_guilds.json')) return dbPath;
                if (joined.endsWith('premium_guilds.json.tmp')) return dbPath + '.tmp';
                return joined;
            },
        };
    });
});

afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
    jest.resetModules();
});

// ── Utility to get a fresh service instance ─────────────────────────────────

function getService() {
    return require('../src/services/premiumService');
}

// ── Test suites ────────────────────────────────────────────────────────────

describe('premiumService.syncAll()', () => {
    test('successful sync: overwrites JSON file and updates in-memory set', async () => {
        global.fetch = mockFetch({
            guilds: ['333', '444', '555'],
            count: 3,
            environment: 'live',
        });

        const service = getService();
        await service.syncAll();

        // In-memory set updated
        expect(service.premiumGuilds.has('333')).toBe(true);
        expect(service.premiumGuilds.has('444')).toBe(true);
        expect(service.premiumGuilds.has('555')).toBe(true);
        // Old guilds removed
        expect(service.premiumGuilds.has('111')).toBe(false);

        // JSON file written atomically
        const onDisk = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        expect(onDisk).toEqual(['333', '444', '555']);
    });

    test('HTTP error: keeps previous cache, does not overwrite JSON', async () => {
        global.fetch = mockFetch({}, 500);

        const service = getService();
        // Seed the service with known guilds
        service.premiumGuilds = new Set(['111', '222']);

        await service.syncAll();

        // Set unchanged
        expect(service.premiumGuilds.has('111')).toBe(true);
        expect(service.premiumGuilds.has('222')).toBe(true);

        // JSON file unchanged
        const onDisk = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        expect(onDisk).toEqual(['111', '222']);
    });

    test('network error: keeps previous cache, does not throw', async () => {
        global.fetch = failingFetch();

        const service = getService();
        service.premiumGuilds = new Set(['111']);

        await expect(service.syncAll()).resolves.toBeUndefined();
        expect(service.premiumGuilds.has('111')).toBe(true);
    });
});

describe('premiumService.isPremium()', () => {
    test('returns true immediately for guilds already in the set (no fetch)', async () => {
        global.fetch = jest.fn(); // should never be called

        const service = getService();
        service.premiumGuilds = new Set(['111']);

        const result = await service.isPremium('111');

        expect(result).toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('per-guild lookup: fetches API on cache miss and caches result for 60 s', async () => {
        global.fetch = mockFetch({ active: true, status: 'active' });

        const service = getService();
        service.premiumGuilds = new Set(); // guild not in global set

        const result = await service.isPremium('999');

        expect(result).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/api/public/premium/999'),
            expect.any(Object),
        );

        // Second call within TTL → cached, no extra fetch
        const result2 = await service.isPremium('999');
        expect(result2).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1); // still just 1
    });

    test('cache expiry: re-fetches after TTL has passed', async () => {
        jest.useFakeTimers();
        global.fetch = mockFetch({ active: false, status: 'none' });

        const service = getService();
        service.premiumGuilds = new Set();

        // First call — populates cache
        await service.isPremium('777');
        expect(global.fetch).toHaveBeenCalledTimes(1);

        // Advance past 60 second TTL
        jest.advanceTimersByTime(61 * 1000);

        // Second call — cache expired, should re-fetch
        await service.isPremium('777');
        expect(global.fetch).toHaveBeenCalledTimes(2);

        jest.useRealTimers();
    });

    test('API error during per-guild lookup: returns cached value, does not throw', async () => {
        global.fetch = failingFetch();

        const service = getService();
        service.premiumGuilds = new Set();
        // Seed a stale cached value
        service._perGuildCache.set('888', { value: true, expiresAt: 0 }); // already expired

        const result = await service.isPremium('888');

        // Falls back to stale cache value
        expect(result).toBe(true);
    });
});
