const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../../premium_guilds.json');

// Initialize
if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify([], null, 2));
}

const getDb = () => {
    try {
        const data = fs.readFileSync(dbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading DB:', err);
        return [];
    }
};

const saveDb = (data) => {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error writing DB:', err);
    }
};

const addPremium = (guildId) => {
    const data = getDb();
    if (!data.includes(guildId)) {
        data.push(guildId);
        saveDb(data);
    }
};

const removePremium = (guildId) => {
    const data = getDb();
    const newData = data.filter(id => id !== guildId);
    saveDb(newData);
};

const isPremium = (guildId) => {
    const data = getDb();
    return data.includes(guildId);
};

module.exports = { addPremium, removePremium, isPremium };
