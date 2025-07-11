// File System is needed to work with other files (data.json for storage)
const fs = require('fs');
// Load environment variables from the .env file
require('dotenv').config();
 
// Import necessary classes from discord.js and EmbedBuilder for rich messages
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const DATA_FILE = './tracked_users.json'; // The file where we'll store our data

// Load tracked users from the file
// The key is the Discord Channel ID, the value is an object with AniList info.
// { "channel_id_123": { "anilistUsername": "someUser", "lastActivityId": 12345 } }
let trackedUsers = {};
try {
    // Check if the file exists before trying to read it
    if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE);
        trackedUsers = JSON.parse(data);
        console.log("Successfully loaded tracked user data.");
    } else {
        console.log("No data file found, starting with an empty list.");
    }
} catch (error) {
    console.error("Error loading data file:", error);
    // If the file is corrupted, start fresh to prevent a crash
    trackedUsers = {}; 
}

// Function to save the trackedUsers object to the file
function saveData() {
    try {
        // JSON.stringify converts our JS object into a string.
        // The `null, 2` arguments make the JSON file human-readable (pretty-printed).
        const data = JSON.stringify(trackedUsers, null, 2);
        fs.writeFileSync(DATA_FILE, data);
        console.log("Data saved successfully.");
    } catch (error) {
        console.error("Error saving data:", error);
    }
}

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
                
                trackedUsers[channelId].lastActivityId = latestActivity.id;
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

                // User found, add them to our tracking object
                trackedUsers[message.channel.id] = {
                    anilistUsername: anilistUsername,
                    anilistUserId: anilistUserId,
                    lastActivityId: null 
                };

                saveData(); // Save the updated trackedUsers object to the file

                // Send a confirmation message to the channel
                message.channel.send(`Successfully found **${anilistUsername}** (ID: ${anilistUserId}). Now tracking in this channel!`);
                console.log(`Started tracking ${anilistUsername} (ID: ${anilistUserId}) for channel ${message.channel.id}`);
                
                // Run an initial check immediately
                checkAniListActivity(message.channel.id);
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
            delete trackedUsers[message.channel.id];
            saveData(); // Save the updated trackedUsers object to the file
            message.channel.send(`Stopped tracking **${username}** in this channel.`);
            console.log(`Stopped tracking for channel ${message.channel.id}`);
        } else {
            message.channel.send('There is no AniList user being tracked in this channel.');
        }

    } else if (command === 'help') {
        message.channel.send('**AniList Bot Commands:**\n`!anilist track <username>` - Start tracking a user in this channel.\n`!anilist untrack` - Stop tracking a user in this channel.');
    }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);