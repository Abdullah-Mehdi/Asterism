const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

// clientId + token can come from Replit Secrets (env) or config.json. Env wins.
let _configFile = {};
try { _configFile = require("./config.json"); } catch { /* file optional */ }
const clientId = process.env.DISCORD_CLIENT_ID ?? _configFile.clientId;
const token    = process.env.DISCORD_TOKEN     ?? _configFile.token;
if (!clientId) {
    console.error("✗ Missing DISCORD_CLIENT_ID — set it in env or config.json.");
    process.exit(1);
}
if (!token) {
    console.error("✗ Missing DISCORD_TOKEN — set it in env or config.json.");
    process.exit(1);
}

// Read every command's `data` block from the registry — single source of truth.
const commands = require("./commands").map(c => c.data.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
    try {
        console.log(`Started refreshing ${commands.length} application (/) GLOBAL commands.`);
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("Successfully reloaded application (/) GLOBAL commands.");
    } catch (error) {
        console.error(error);
    }
})();
