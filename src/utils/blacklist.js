const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../../blacklist.json');

// Initialize
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([], null, 2));
}

const getDb = () => {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading Blacklist DB:', err);
        return [];
    }
};

const saveDb = (data) => {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing Blacklist DB:', err);
    }
};

const addBlacklist = (guildId) => {
    const data = getDb();
    if (!data.includes(guildId)) {
        data.push(guildId);
        saveDb(data);
    }
};

const removeBlacklist = (guildId) => {
    const data = getDb();
    const newData = data.filter(id => id !== guildId);
    saveDb(newData);
};

const isBlacklisted = (guildId) => {
    const data = getDb();
    return data.includes(guildId);
};

module.exports = { addBlacklist, removeBlacklist, isBlacklisted };
