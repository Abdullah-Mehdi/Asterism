// 'sqlite' package for modern async/await support
const { open } = require("sqlite");
const sqlite3 = require("sqlite3").verbose();

// Import your config
const { token } = require("./config.json");

// Import necessary classes from discord.js
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    MessageFlags,
} = require("discord.js");
const fetch = require("node-fetch");

let trackedUsers = {}; // in-memory copy for speed
let db; // Initialize the database in our main async function

// Create a new client instance
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// ANILIST CHECKING LOGIC
async function checkAniListActivity(channelId, anilistUserId) {
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return;

    const { anilistUsername, lastActivityId } = trackingInfo;
    const query = `query ($userId: Int) { Page(page: 1, perPage: 1) { activities(userId: $userId, sort: ID_DESC, type: MEDIA_LIST) { ... on ListActivity { id status progress createdAt media { title { romaji, english }, coverImage { large }, siteUrl } } } } }`;
    const variables = { userId: anilistUserId };
    const url = "https://graphql.anilist.co";
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query, variables }),
    };

    try {
        const response = await fetch(url, options);
        const data = await response.json();

        if (data.data.Page.activities && data.data.Page.activities.length > 0) {
            const latestActivity = data.data.Page.activities[0];
            if (latestActivity.id !== lastActivityId) {
                console.log(
                    `New activity for ${anilistUsername}: ${latestActivity.id}`,
                );
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    const mediaTitle =
                        latestActivity.media.title.english ||
                        latestActivity.media.title.romaji;
                    const embed = new EmbedBuilder()
                        .setColor("#C3B1E1")
                        .setAuthor({
                            name: `${anilistUsername}'s Activity`,
                            url: `https://anilist.co/user/${anilistUsername}/`,
                        })
                        .setDescription(
                            `${latestActivity.status} ${latestActivity.progress || ""} ... **[${mediaTitle}](${latestActivity.media.siteUrl})**`,
                        )
                        .setThumbnail(latestActivity.media.coverImage.large)
                        .setTimestamp(latestActivity.createdAt * 1000)
                        .setFooter({ text: "From AniList" });
                    channel.send({ embeds: [embed] });
                }
                const newActivityId = latestActivity.id;
                const sql = `UPDATE tracked_users SET lastActivityId = ? WHERE channelId = ? AND anilistUserId = ?`;
                await db.run(sql, [newActivityId, channelId, anilistUserId]);

                trackedUsers[channelId][anilistUserId].lastActivityId =
                    newActivityId;
                console.log(
                    `Updated lastActivityId to ${newActivityId} for channel ${channelId} in DB.`,
                );
            }
        }
    } catch (error) {
        console.error(`Error fetching activity for ${anilistUsername}:`, error);
    }
}

// BOT STARTUP LOGIC
client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    setInterval(() => {
        console.log("Checking for new AniList activity...");
        for (const channelId in trackedUsers) {
            for (const anilistUserId in trackedUsers[channelId]) {
                checkAniListActivity(channelId, anilistUserId);
            }
        }
    }, 300000);
});

// SLASH COMMAND HANDLER
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // Still defer, as it's best practice.
    try {
        await interaction.deferReply({
            ephemeral: ["list", "help", "untrack"].includes(commandName),
        });
    } catch (error) {
        console.error(
            "Failed to defer reply, the interaction is likely too old:",
            error,
        );
        return; // Can't do anything if we can't even defer.
    }

    try {
        // COMMAND LOGIC
        if (commandName === "help") {
            const helpEmbed = new EmbedBuilder()
                .setColor("#C3B1E1")
                .setTitle("AniList Bot Commands")
                .addFields(
                    {
                        name: "/track <username>",
                        value: "Starts tracking a user's activity in this channel.",
                    },
                    {
                        name: "/untrack <username>",
                        value: "Stops tracking a specific user in this channel.",
                    },
                    {
                        name: "/list",
                        value: "Shows all AniList users currently being tracked in this channel.",
                    },
                    { name: "/help", value: "Displays this list of commands." },
                );
            await interaction.editReply({ embeds: [helpEmbed] });
        } else if (commandName === "list") {
            const usersInChannel = trackedUsers[interaction.channelId];
            const listEmbed = new EmbedBuilder()
                .setColor("#C3B1E1")
                .setTitle(`AniList Users Tracked in this Channel`);
            if (usersInChannel && Object.keys(usersInChannel).length > 0) {
                listEmbed.setDescription(
                    Object.values(usersInChannel)
                        .map((user) => `• **${user.anilistUsername}**`)
                        .join("\n"),
                );
            } else {
                listEmbed.setDescription(
                    "No users are currently being tracked in this channel.",
                );
            }
            await interaction.editReply({ embeds: [listEmbed] });
        } else if (commandName === "track") {
            const anilistUsername = interaction.options.getString("username");
            const channelId = interaction.channelId;
            const findUserQuery = `query ($username: String) { User(name: $username) { id } }`;
            const response = await fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    query: findUserQuery,
                    variables: { username: anilistUsername },
                }),
            });
            const data = await response.json();
            if (!data.data || !data.data.User)
                return interaction.editReply(
                    `Could not find an AniList user with the username **${anilistUsername}**. Please check spelling.`,
                );
            const anilistUserId = data.data.User.id;
            if (trackedUsers[channelId]?.[anilistUserId])
                return interaction.editReply(
                    `**${anilistUsername}** is already being tracked in this channel.`,
                );
            const sql = `INSERT INTO tracked_users (channelId, anilistUsername, anilistUserId, lastActivityId) VALUES (?, ?, ?, ?)`;
            await db.run(sql, [
                channelId,
                anilistUsername,
                anilistUserId,
                null,
            ]);
            console.log(
                `[SUCCESS] Database write for ${anilistUsername} has completed.`,
            );
            if (!trackedUsers[channelId]) trackedUsers[channelId] = {};
            trackedUsers[channelId][anilistUserId] = {
                anilistUsername: anilistUsername,
                lastActivityId: null,
            };
            await interaction.editReply(
                `Successfully found **${anilistUsername}**. Now tracking them in this channel!`,
            );
            checkAniListActivity(channelId, anilistUserId);
        } else if (commandName === "untrack") {
            const usernameToUntrack = interaction.options.getString("username");
            const channelId = interaction.channelId;
            const usersInChannel = trackedUsers[channelId];
            if (!usersInChannel)
                return interaction.editReply({
                    content:
                        "No users are currently being tracked in this channel.",
                });
            let userToUntrackInfo = null,
                userIdToUntrack = null;
            for (const userId in usersInChannel) {
                if (
                    usersInChannel[userId].anilistUsername.toLowerCase() ===
                    usernameToUntrack.toLowerCase()
                ) {
                    userToUntrackInfo = usersInChannel[userId];
                    userIdToUntrack = userId;
                    break;
                }
            }
            if (!userToUntrackInfo)
                return interaction.editReply({
                    content: `**${usernameToUntrack}** is not being tracked in this channel.`,
                });
            const sql = `DELETE FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`;
            await db.run(sql, [channelId, userIdToUntrack]);
            delete trackedUsers[channelId][userIdToUntrack];
            if (Object.keys(trackedUsers[channelId]).length === 0)
                delete trackedUsers[channelId];
            await interaction.editReply(
                `Stopped tracking **${userToUntrackInfo.anilistUsername}** in this channel.`,
            );
        }
    } catch (error) {
        // ERROR HANDLER
        console.error(
            `An error occurred while executing the /${commandName} command:`,
            error,
        );

        // Use followUp to send a new, separate message
        await interaction.followUp({
            content: "There was an error while executing this command!",
            ephemeral: true,
        });
    }
});

// MAIN STARTUP FUNCTION
// Wrap startup in an async function to use 'await' for opening the database.
async function startBot() {
    try {
        // Open the database connection
        db = await open({
            filename: "./bot.db",
            driver: sqlite3.Database,
        });
        console.log("Connected to the SQLite database.");

        // Create the table if it doesn't exist
        await db.exec(
            `CREATE TABLE IF NOT EXISTS tracked_users (channelId TEXT NOT NULL, anilistUserId INTEGER NOT NULL, anilistUsername TEXT NOT NULL, lastActivityId INTEGER, PRIMARY KEY (channelId, anilistUserId))`,
        );
        console.log("tracked_users table is ready.");

        // Load all users from the database into memory
        const rows = await db.all("SELECT * FROM tracked_users");
        rows.forEach((row) => {
            if (!trackedUsers[row.channelId]) trackedUsers[row.channelId] = {};
            trackedUsers[row.channelId][row.anilistUserId] = {
                anilistUsername: row.anilistUsername,
                lastActivityId: row.lastActivityId,
            };
        });
        console.log(
            `Loaded ${rows.length} tracked entries from the database into memory.`,
        );

        // Finally, log in to Discord
        console.log("Database loaded. Logging into Discord...");
        client.login(token);
    } catch (error) {
        console.error("Failed to start the bot:", error);
        process.exit(1); // Exit if we can't connect to the DB
    }
}

// Run the main startup function
startBot();
