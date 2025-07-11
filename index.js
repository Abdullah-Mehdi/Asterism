// Needed for SQLite database operations
const sqlite3 = require('sqlite3').verbose();
// Load environment variables from the .env file
require('dotenv').config();
 
// Import necessary classes from discord.js and EmbedBuilder for rich messages
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

let trackedUsers = {}; // in-memory copy for speed

// Initialize the SQLite database
const db = new sqlite3.Database('./bot.db', (err) => {
    if (err) {
        return console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Use db.serialize to ensure commands run in order
db.serialize(() => {
    // 1. First, run the CREATE TABLE command.
    db.run(`CREATE TABLE IF NOT EXISTS users (
        channelId TEXT PRIMARY KEY,
        anilistUsername TEXT NOT NULL,
        anilistUserId INTEGER NOT NULL,
        lastActivityId INTEGER
    )`, (err) => {
        if (err) {
            return console.error("Error creating table:", err.message);
        }
        console.log("Users table is ready.");
    });

    // 2. ONLY AFTER the above is sent, run the SELECT command.
    db.all("SELECT * FROM users", [], (err, rows) => {
        if (err) {
            console.error("Error loading users from DB:", err.message);
            throw err;
        }
        rows.forEach((row) => {
            trackedUsers[row.channelId] = {
                anilistUsername: row.anilistUsername,
                anilistUserId: row.anilistUserId,
                lastActivityId: row.lastActivityId
            };
        });
        console.log(`Loaded ${rows.length} users from the database into memory.`);
    });
});


// Create a new client instance
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // This is required!
    ]
});

// When the client is ready, run this code (only once)
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

const fetch = require('node-fetch');

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
async function checkAniListActivity(channelId) {
    const trackingInfo = trackedUsers[channelId];
    // We need both the username and the ID to proceed, two API calls 🥴
    if (!trackingInfo || !trackingInfo.anilistUserId) return;

    const { anilistUsername, anilistUserId, lastActivityId } = trackingInfo;

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

    const url = 'https://graphql.anilist.co';
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: query, variables: variables })
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
                console.log(`New activity for ${anilistUsername}: ${latestActivity.id}`);
                
                // Create an embed message to send to the Discord channel
                // Fetch the channel using the channelId
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    const mediaTitle = latestActivity.media.title.english || latestActivity.media.title.romaji;
                    const embed = new EmbedBuilder()
                        .setColor('#02A9FF')
                        .setAuthor({ name: `${anilistUsername}'s Activity`, url: `https://anilist.co/user/${anilistUsername}/` })
                        .setDescription(`${latestActivity.status} ${latestActivity.progress || ''} of **[${mediaTitle}](${latestActivity.media.siteUrl})**`)
                        .setThumbnail(latestActivity.media.coverImage.large)
                        .setTimestamp(latestActivity.createdAt * 1000)
                        .setFooter({ text: 'From AniList' });
                    channel.send({ embeds: [embed] });
                }
                
                // Update the lastActivityId in the database
                const newActivityId = latestActivity.id;

                const sql = `UPDATE users SET lastActivityId = ? WHERE channelId = ?`;
                db.run(sql, [newActivityId, channelId], (err) => {
                    if (err) {
                        return console.error(err.message);
                    }
                    // Also update our in-memory object to stay in sync
                    trackedUsers[channelId].lastActivityId = newActivityId;
                    console.log(`Updated lastActivityId to ${newActivityId} for channel ${channelId} in DB.`);
                });
            }
        }
    } catch (error) {
        console.error(`Error fetching activity for ${anilistUsername}:`, error);
    }
}

// When the bot is ready, start a loop to check for updates every 5 minutes
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Check every 5 minutes (300,000 milliseconds)
    setInterval(() => {
        console.log("Checking for new AniList activity...");
        for (const channelId in trackedUsers) {
            checkAniListActivity(channelId);
        }
    }, 300000); 
});

// Listen for messages
client.on('messageCreate', message => {
    if (message.author.bot) return;

    const prefix = '!anilist';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

if (command === 'track' || command === 'register') {
    const anilistUsername = args[0];
    if (!anilistUsername) {
        return message.channel.send('Please provide an AniList username. Usage: `!anilist track <username>`');
    }

    // First, find the user's ID
    const findUserQuery = `
        query ($username: String) {
            User(name: $username) {
                id
            }
        }`;
    const variables = { username: anilistUsername }; 
    const url = 'https://graphql.anilist.co'; // AniList GraphQL endpoint
    // Prepare the request options
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: findUserQuery, variables: variables })
    };

    // Use .then() and .catch() for this async operation
    fetch(url, options)
        .then(response => response.json())
        .then(data => {
            if (data.data && data.data.User) {
                const anilistUserId = data.data.User.id;

                // The user object we want to save
                const userToTrack = {
                    anilistUsername: anilistUsername,
                    anilistUserId: anilistUserId,
                    lastActivityId: null
                };

                //Database writing
                const sql = `REPLACE INTO users (channelId, anilistUsername, anilistUserId, lastActivityId) VALUES (?, ?, ?, ?)`;
                db.run(sql, [message.channel.id, anilistUsername, anilistUserId, null], (err) => {
                    if (err) {
                        return console.error(err.message);
                    }
                    console.log(`User ${anilistUsername} saved to database for channel ${message.channel.id}`);
                    
                    // Also update our in-memory object
                    trackedUsers[message.channel.id] = userToTrack;

                    message.channel.send(`Successfully found **${anilistUsername}**. Now tracking in this channel!`);
                    checkAniListActivity(message.channel.id);
                });
            } else {
                // User not found
                message.channel.send(`Could not find an AniList user with the username **${anilistUsername}**. Please check the spelling.`);
            }
        })
        .catch(error => {
            console.error("Error finding user:", error);
            message.channel.send("An error occurred while trying to find the user on AniList.");
        });

    } else if (command === 'untrack' || command === 'unregister') {
        if (trackedUsers[message.channel.id]) {
            const username = trackedUsers[message.channel.id].anilistUsername;

            // Database deletion
            const sql = `DELETE FROM users WHERE channelId = ?`;
            db.run(sql, [message.channel.id], (err) => {
                if (err) {
                    return console.error(err.message);
                }
                console.log(`Removed user from database for channel ${message.channel.id}`);
                
                // Also update our in-memory object
                delete trackedUsers[message.channel.id];

                message.channel.send(`Stopped tracking **${username}** in this channel.`);
            });
        } else {
            message.channel.send('There is no AniList user being tracked in this channel.');
        }

    } else if (command === 'help') {
        message.channel.send('**AniList Bot Commands:**\n`!anilist track <username>` - Start tracking a user in this channel.\n`!anilist untrack` - Stop tracking a user in this channel.');
    }
});

// Simple web server to keep the bot alive on Replit
const http = require('http');
http.createServer(function (req, res) {
  res.write("I'm alive");
  res.end();
}).listen(8080);

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);