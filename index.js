// sqlite async/await ke liye
const { open } = require("sqlite");
const sqlite3 = require("sqlite3").verbose();

// config file se token import karna
const { token } = require("./config.json");

// discord.js ke zaroori classes
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    MessageFlags,
} = require("discord.js");
const fetch = require("node-fetch");

// agar koi promise reject ho jaye to bot crash na ho
process.on("unhandledRejection", (error) => {
    console.error("CRITICAL: Unhandled Promise Rejection:", error);
    // error log kar dete hain lekin bot ko crash nahi karte
});

let trackedUsers = {}; // memory mein users ka data rakhe ga
let db; // database ka instance

// AniList profile colors ko hex codes mein convert karne ke liye mapping
const anilistColorMap = {
    blue: "#3DB4F2",
    purple: "#C063FF",
    pink: "#FC9DD6",
    orange: "#EF881A",
    red: "#E13333",
    green: "#4CCA51",
    gray: "#677B94",
};

// discord client banate hain
const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// AniList activity check karne ka function
async function checkAniListActivity(channelId, anilistUserId) {
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return;

    const { anilistUsername, lastActivityId } = trackingInfo;

    // First fetch user profile info (avatar and color)
    const userQuery = `query ($userId: Int) { User(id: $userId) { avatar { large }, options { profileColor } } }`;
    const activityQuery = `query ($userId: Int) { Page(page: 1, perPage: 50) { activities(userId: $userId, sort: ID_DESC, type: MEDIA_LIST) { ... on ListActivity { id status progress createdAt media { title { romaji, english }, coverImage { large }, siteUrl } } } } }`;
    const variables = { userId: anilistUserId };
    const url = "https://graphql.anilist.co";

    try {
        // Fetch user profile data
        const userResponse = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ query: userQuery, variables }),
        });
        const userData = await userResponse.json();
        const userAvatar = userData.data?.User?.avatar?.large;
        const userColor = userData.data?.User?.options?.profileColor;

        // Fetch activities
        const activityResponse = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ query: activityQuery, variables }),
        });
        const activityData = await activityResponse.json();

        if (
            activityData.data.Page.activities &&
            activityData.data.Page.activities.length > 0
        ) {
            const activities = activityData.data.Page.activities;

            // Find all new activities (those with ID greater than lastActivityId)
            const newActivities = lastActivityId
                ? activities.filter((activity) => activity.id > lastActivityId)
                : [activities[0]]; // If no lastActivityId, only show the most recent one

            if (newActivities.length > 0) {
                // Cap at 15 activities to prevent spam, but still update to latest
                const activitiesToShow = newActivities.slice(0, 15);
                const skippedCount = newActivities.length - activitiesToShow.length;
                
                console.log(
                    `${newActivities.length} new activity/activities for ${anilistUsername}` +
                    (skippedCount > 0 ? ` (showing ${activitiesToShow.length}, skipping ${skippedCount} older ones)` : ''),
                );
                const channel = await client.channels.fetch(channelId);

                if (channel) {
                    // Sort activities oldest to newest for posting
                    activitiesToShow.reverse();

                    // Determine embed color (use profile color or default)
                    const embedColor = userColor 
                        ? (anilistColorMap[userColor.toLowerCase()] || "#C3B1E1")
                        : "#C3B1E1";
                    
                    for (const activity of activitiesToShow) {
                        const mediaTitle =
                            activity.media.title.english ||
                            activity.media.title.romaji;
                        const embed = new EmbedBuilder()
                            .setColor(embedColor)
                            .setAuthor({
                                name: `${anilistUsername}'s Activity`,
                                iconURL: userAvatar,
                                url: `https://anilist.co/user/${anilistUsername}/`,
                            })
                            .setDescription(
                                `${activity.status} ${activity.progress || ""} - **[${mediaTitle}](${activity.media.siteUrl})**`,
                            )
                            .setThumbnail(activity.media.coverImage.large)
                            .setTimestamp(activity.createdAt * 1000)
                            .setFooter({ text: "From AniList" });
                        await channel.send({ embeds: [embed] });
                    }
                }

                // Update to the most recent activity ID
                const mostRecentActivityId = activities[0].id;
                const sql = `UPDATE tracked_users SET lastActivityId = ? WHERE channelId = ? AND anilistUserId = ?`;
                await db.run(sql, [
                    mostRecentActivityId,
                    channelId,
                    anilistUserId,
                ]);
                trackedUsers[channelId][anilistUserId].lastActivityId =
                    mostRecentActivityId;
                console.log(
                    `Updated lastActivityId to ${mostRecentActivityId} for channel ${channelId} in DB.`,
                );
            }
        }
    } catch (error) {
        console.error(`Error fetching activity for ${anilistUsername}:`, error);
    }
}

// bot ready hone par
client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Immediately check once on startup
    console.log("Checking for new AniList activity (initial check)...");
    for (const channelId in trackedUsers) {
        for (const anilistUserId in trackedUsers[channelId]) {
            checkAniListActivity(channelId, anilistUserId);
        }
    }
    
    // Then set up the interval for regular checks
    setInterval(() => {
        console.log("Checking for new AniList activity...");
        for (const channelId in trackedUsers) {
            for (const anilistUserId in trackedUsers[channelId]) {
                checkAniListActivity(channelId, anilistUserId);
            }
        }
    }, 600000); // har 10 minute mein check karte hain
});

// slash commands handle karte hain
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    try {
        // ephemeral replies ke liye flags use karte hain
        await interaction.deferReply({
            flags: ["list", "help", "untrack"].includes(commandName)
                ? [MessageFlags.Ephemeral]
                : undefined,
        });
    } catch (error) {
        console.error(
            "Fatal: Failed to defer reply. The interaction is likely invalid.",
            error,
        );
        return;
    }

    try {
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
            // database mein save ho gaya
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
        console.error(
            `An error occurred while executing the /${commandName} command:`,
            error,
        );
        try {
            await interaction.followUp({
                content: "There was an error while executing this command!",
                ephemeral: true,
            });
        } catch (followUpError) {
            console.error(
                "Could not even send a followup error message:",
                followUpError,
            );
        }
    }
});

// bot ko start karne ka main function
async function startBot() {
    try {
        db = await open({ filename: "./bot.db", driver: sqlite3.Database });
        console.log("Connected to the SQLite database.");
        await db.exec(
            `CREATE TABLE IF NOT EXISTS tracked_users (channelId TEXT NOT NULL, anilistUserId INTEGER NOT NULL, anilistUsername TEXT NOT NULL, lastActivityId INTEGER, PRIMARY KEY (channelId, anilistUserId))`,
        );
        console.log("tracked_users table is ready.");
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
        console.log("Database loaded. Logging into Discord...");
        client.login(token);
    } catch (error) {
        console.error("Failed to start the bot:", error);
        process.exit(1);
    }
}

// bot shuru karte hain
startBot();
