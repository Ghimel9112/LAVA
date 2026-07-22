const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('ephemeral: true')) {
                // Replace the string
                content = content.replace(/ephemeral:\s*true/g, 'flags: MessageFlags.Ephemeral');
                
                // Make sure MessageFlags is imported
                if (!content.includes('MessageFlags')) {
                    // Try to add it to existing discord.js import
                    if (content.includes("require('discord.js')") || content.includes('require("discord.js")')) {
                        content = content.replace(/(const\s+\{[^}]*)(\}\s*=\s*require\(['"]discord.js['"]\);)/, (match, p1, p2) => {
                            if (p1.trim().endsWith('{')) return p1 + ' MessageFlags ' + p2;
                            return p1 + ', MessageFlags ' + p2;
                        });
                    } else {
                        // Just add it at the top
                        content = `const { MessageFlags } = require('discord.js');\n` + content;
                    }
                }
                fs.writeFileSync(fullPath, content);
                console.log('Fixed ' + fullPath);
            }
        }
    }
}

processDir('./src');
