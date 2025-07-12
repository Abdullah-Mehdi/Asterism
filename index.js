// Needed for SQLite database operations
const sqlite3 = require("sqlite3").verbose();
// Load environment variables from the .env file
require("dotenv").config();

// Import necessary classes from discord.js and EmbedBuilder for rich messages
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

let trackedUsers = {}; // in-memory copy for speed

// Initialize the SQLite database
const db = new sqlite3.Database("./bot.db", (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log("Connected to the SQLite database.");
});

// Use db.serialize to ensure commands run in order
db.serialize(() => {
    // 1. First, run the CREATE TABLE command.
    db.run(
        `CREATE TABLE IF NOT EXISTS tracked_users (
        channelId TEXT NOT NULL,
        anilistUserId INTEGER NOT NULL,
        anilistUsername TEXT NOT NULL,
        lastActivityId INTEGER,
        PRIMARY KEY (channelId, anilistUserId)
    )`,
        (err) => {
            if (err) {
                return console.error("Error creating table:", err.message);
            }
            console.log("tracked_users table is ready.");
        },
    );

    // 2. ONLY AFTER the above is sent, run the SELECT command.
    db.all("SELECT * FROM tracked_users", [], (err, rows) => {
        if (err) {
            console.error("Error loading users from DB:", err.message);
            throw err;
        }
        rows.forEach((row) => {
            // If this channel isn't in our object yet, create it
            if (!trackedUsers[row.channelId]) {
                trackedUsers[row.channelId] = {};
            }
            // Store the user's data, keyed by their AniList ID
            trackedUsers[row.channelId][row.anilistUserId] = {
                anilistUsername: row.anilistUsername,
                lastActivityId: row.lastActivityId,
            };
        });
        console.log(
            `Loaded ${rows.length} tracked entries from the database into memory.`,
        );

        // Only log in to Discord AFTER the database is fully loaded.
        console.log("Database loaded. Logging into Discord...");
        client.login(process.env.DISCORD_TOKEN);
    });
});

// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // This is required!
    ],
});

const fetch = require("node-fetch");

// The GraphQL query
const query = `
query ($username: String) {
  Page(page: 1, perPage: 1) {
    activities(userName: $username, sort: ID_DESC, type: MEDIA_LIST) {
      ... on ListActivity {
        id
        status
        progress
        createdAt
        media {
          title {
            romaji
            english
          }
          coverImage {
            large
          }
          siteUrl
        }
      }
    }
  }
}
`;

// Function to check a single user's AniList activity
async function checkAniListActivity(channelId, anilistUserId) {
    // Get the specific user's tracking info
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return; // Safety check

    const { anilistUsername, lastActivityId } = trackingInfo;

    const query = `
        query ($userId: Int) {
            Page(page: 1, perPage: 1) {
                activities(userId: $userId, sort: ID_DESC, type: MEDIA_LIST) {
                    ... on ListActivity {
                        id
                        status
                        progress
                        createdAt
                        media {
                            title { romaji, english },
                            coverImage { large },
                            siteUrl
                        }
                    }
                }
            }
        }`;

    const variables = { userId: anilistUserId };

    const url = "https://graphql.anilist.co";
    const options = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify({ query: query, variables: variables }),
    };

    // Fetch the latest activity for the user
    try {
        const response = await fetch(url, options);
        const data = await response.json();

        // Check if we got any activities back
        if (data.data.Page.activities && data.data.Page.activities.length > 0) {
            const latestActivity = data.data.Page.activities[0];

            // If the latest activity ID is different from the last tracked one, send a message
            if (latestActivity.id !== lastActivityId) {
                console.log(
                    `New activity for ${anilistUsername}: ${latestActivity.id}`,
                );

                // Create an embed message to send to the Discord channel
                // Fetch the channel using the channelId
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    const mediaTitle =
                        latestActivity.media.title.english ||
                        latestActivity.media.title.romaji;
                    const embed = new EmbedBuilder()
                        .setColor("#bbadff")
                        .setAuthor({
                            name: `${anilistUsername}'s Activity`,
                            url: `https://anilist.co/user/${anilistUsername}/`,
                        })
                        .setDescription(
                            `${latestActivity.status} ${latestActivity.progress || ""} of **[${mediaTitle}](${latestActivity.media.siteUrl})**`,
                        )
                        .setThumbnail(latestActivity.media.coverImage.large)
                        .setTimestamp(latestActivity.createdAt * 1000)
                        .setFooter({ text: "From AniList" });
                    channel.send({ embeds: [embed] });
                }

                // Update the lastActivityId in the database
                const newActivityId = latestActivity.id;

                const sql = `UPDATE tracked_users SET lastActivityId = ? WHERE channelId = ? AND anilistUserId = ?`;
                db.run(
                    sql,
                    [newActivityId, channelId, anilistUserId],
                    (err) => {
                        if (err) {
                            return console.error(err.message);
                        }
                        // Also update our in-memory object to stay in sync
                        trackedUsers[channelId][anilistUserId].lastActivityId =
                            newActivityId;
                        console.log(
                            `Updated lastActivityId to ${newActivityId} for channel ${channelId} in DB.`,
                        );
                    },
                );
            }
        }
    } catch (error) {
        console.error(`Error fetching activity for ${anilistUsername}:`, error);
    }
}

// When the bot is ready, run ALL startup logic
client.on("ready", () => {
    // 1. Log that the bot is online.
    console.log(`Logged in as ${client.user.tag}!`);

    // 2. Start the five-minute checking interval.
    setInterval(() => {
        console.log("Checking for new AniList activity...");
        // Loop through each channel being tracked
        for (const channelId in trackedUsers) {
            // Loop through each user being tracked in that channel
            for (const anilistUserId in trackedUsers[channelId]) {
                checkAniListActivity(channelId, anilistUserId);
            }
        }
    }, 300000); // 5 minutes in milliseconds
});

// Listen for messages
client.on("messageCreate", (message) => {
    if (message.author.bot) return;

    const prefix = "!anilist";
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // list command
    if (command === "list") {
        const channelId = message.channel.id;
        const usersInChannel = trackedUsers[channelId];

        const listEmbed = new EmbedBuilder()
            .setColor("#bbadff")
            .setTitle(`AniList Users Tracked in this Channel`);

        if (usersInChannel && Object.keys(usersInChannel).length > 0) {
            // Map the user objects to a formatted string
            const listOfUsers = Object.values(usersInChannel)
                .map((user) => `• **${user.anilistUsername}**`)
                .join("\n"); // Join them with newlines

            listEmbed.setDescription(listOfUsers);
        } else {
            listEmbed.setDescription(
                "No users are currently being tracked in this channel.",
            );
        }

        return message.channel.send({ embeds: [listEmbed] });
    }

    // help command
    else if (command === "help") {
        const helpEmbed = new EmbedBuilder()
            .setColor("#bbadff")
            .setTitle("AniList Bot Commands")
            .setDescription(
                "Here are all the available commands and how to use them:",
            )
            .addFields(
                {
                    name: "Track a User",
                    value: "`!anilist track <username>`\nStarts tracking a user's activity in this channel.",
                },
                {
                    name: "Untrack a User",
                    value: "`!anilist untrack <username>`\nStops tracking a specific user in this channel.",
                },
                {
                    name: "List Tracked Users",
                    value: "`!anilist list`\nShows all AniList users currently being tracked in this channel.",
                },
                {
                    name: "Show This Help Message",
                    value: "`!anilist help`\nDisplays this list of commands.",
                },
            )
            .setFooter({
                text: "Remember to replace <username> with a real AniList username!",
            });

        return message.channel.send({ embeds: [helpEmbed] });
    } else if (command === "track" || command === "register") {
        const anilistUsername = args[0];
        if (!anilistUsername) {
            return message.channel.send(
                "Please provide an AniList username. Usage: `!anilist track <username>`",
            );
        }

        // Tracking logic
        const findUserQuery = `query ($username: String) { User(name: $username) { id } }`;
        const variables = { username: anilistUsername };
        const url = "https://graphql.anilist.co";
        const options = {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({
                query: findUserQuery,
                variables: variables,
            }),
        };
        fetch(url, options)
            .then((response) => response.json())
            .then((data) => {
                if (data.data && data.data.User) {
                    const anilistUserId = data.data.User.id;
                    const channelId = message.channel.id;
                    if (
                        trackedUsers[channelId] &&
                        trackedUsers[channelId][anilistUserId]
                    ) {
                        return message.channel.send(
                            `**${anilistUsername}** is already being tracked in this channel.`,
                        );
                    }
                    const sql = `INSERT INTO tracked_users (channelId, anilistUsername, anilistUserId, lastActivityId) VALUES (?, ?, ?, ?)`;
                    db.run(
                        sql,
                        [channelId, anilistUsername, anilistUserId, null],
                        (err) => {
                            if (err) {
                                console.error(
                                    "DB Error on track:",
                                    err.message,
                                );
                                return message.channel.send(
                                    "An error occurred while trying to track this user.",
                                );
                            }
                            if (!trackedUsers[channelId]) {
                                trackedUsers[channelId] = {};
                            }
                            trackedUsers[channelId][anilistUserId] = {
                                anilistUsername: anilistUsername,
                                lastActivityId: null,
                            };
                            message.channel.send(
                                `Successfully found **${anilistUsername}**. Now tracking them in this channel!`,
                            );
                            checkAniListActivity(channelId, anilistUserId);
                        },
                    );
                } else {
                    message.channel.send(
                        `Could not find an AniList user with the username **${anilistUsername}**. Please check the spelling.`,
                    );
                }
            })
            .catch((error) => {
                console.error("Error finding user:", error);
                message.channel.send(
                    "An error occurred while trying to find the user on AniList.",
                );
            });
    } else if (command === "untrack" || command === "unregister") {
        const channelId = message.channel.id;
        const usersInChannel = trackedUsers[channelId];
        const usernameToUntrack = args[0];

        // 'untrack' usage message
        if (!usernameToUntrack) {
            return message.channel.send(
                "Please provide a username to untrack. Use `!anilist list` to see who is currently being tracked.",
            );
        }

        if (!usersInChannel) {
            return message.channel.send(
                "No users are currently being tracked in this channel.",
            );
        }

        // Untrack logic
        let userToUntrack = null;
        let userIdToUntrack = null;
        for (const userId in usersInChannel) {
            if (
                usersInChannel[userId].anilistUsername.toLowerCase() ===
                usernameToUntrack.toLowerCase()
            ) {
                userToUntrack = usersInChannel[userId];
                userIdToUntrack = userId;
                break;
            }
        }
        if (!userToUntrack) {
            return message.channel.send(
                `**${usernameToUntrack}** is not being tracked in this channel.`,
            );
        }
        const sql = `DELETE FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`;
        db.run(sql, [channelId, userIdToUntrack], (err) => {
            if (err) {
                console.error("DB Error on untrack:", err.message);
                return message.channel.send(
                    "An error occurred while trying to untrack this user.",
                );
            }
            delete trackedUsers[channelId][userIdToUntrack];
            if (Object.keys(trackedUsers[channelId]).length === 0) {
                delete trackedUsers[channelId];
            }
            message.channel.send(
                `Stopped tracking **${userToUntrack.anilistUsername}** in this channel.`,
            );
        });
    }
});

// Simple web server to keep the bot alive on Replit
const http = require("http");
http.createServer(function (req, res) {
    res.write("I'm alive");
    res.end();
}).listen(8080);

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
