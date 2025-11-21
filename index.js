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
const PROFILE_CACHE_DURATION = 86400000; // 24 hours in milliseconds

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

// Helper function to get the correct title based on user preference
function getPreferredTitle(mediaTitles, preference) {
    switch (preference) {
        case "ENGLISH":
            return mediaTitles.english || mediaTitles.romaji || mediaTitles.native;
        case "NATIVE":
            return mediaTitles.native || mediaTitles.romaji || mediaTitles.english;
        case "ROMAJI":
        case "ROMAJI_STYLISED":
        default:
            return mediaTitles.romaji || mediaTitles.english || mediaTitles.native;
    }
}

// AniList activity check karne ka function
async function checkAniListActivity(channelId, anilistUserId) {
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return;

    const { anilistUsername, lastActivityId, userAvatar, userColor, titleLanguage, profileLastUpdated } = trackingInfo;
    const url = "https://graphql.anilist.co";
    const now = Date.now();
    
    // Check if we need to refresh profile data (older than 24 hours or missing)
    const needsProfileRefresh = !profileLastUpdated || (now - profileLastUpdated) > PROFILE_CACHE_DURATION;

    try {
        let currentAvatar = userAvatar;
        let currentColor = userColor;
        let currentTitleLanguage = titleLanguage || "ROMAJI";
        
        // Combined query: Fetch both user profile (if needed) and activities in ONE request
        const combinedQuery = needsProfileRefresh
            ? `query ($userId: Int) { 
                User(id: $userId) { 
                    avatar { large }, 
                    options { profileColor, titleLanguage } 
                }
                Page(page: 1, perPage: 50) { 
                    activities(userId: $userId, sort: ID_DESC, type: MEDIA_LIST) { 
                        ... on ListActivity { 
                            id status progress createdAt 
                            media { 
                                id
                                title { romaji, english, native }, 
                                coverImage { large }, 
                                siteUrl 
                            } 
                        } 
                    } 
                }
            }`
            : `query ($userId: Int) { 
                Page(page: 1, perPage: 50) { 
                    activities(userId: $userId, sort: ID_DESC, type: MEDIA_LIST) { 
                        ... on ListActivity { 
                            id status progress createdAt 
                            media { 
                                id
                                title { romaji, english, native }, 
                                coverImage { large }, 
                                siteUrl 
                            } 
                        } 
                    } 
                }
            }`;
        
        const variables = { userId: anilistUserId };
        
        // Single API call for everything
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ query: combinedQuery, variables }),
        });
        const data = await response.json();
        
        // Validate API response
        if (!data || !data.data) {
            console.error(`✗ Invalid API response for ${anilistUsername}:`, data?.errors || "Unknown error");
            return;
        }
        
        // Update profile data if we fetched it
        if (needsProfileRefresh && data.data?.User) {
            currentAvatar = data.data.User.avatar?.large;
            currentColor = data.data.User.options?.profileColor;
            currentTitleLanguage = data.data.User.options?.titleLanguage || "ROMAJI";
            
            // Update database with new profile data
            await db.run(
                `UPDATE tracked_users SET userAvatar = ?, userColor = ?, titleLanguage = ?, profileLastUpdated = ? WHERE channelId = ? AND anilistUserId = ?`,
                [currentAvatar, currentColor, currentTitleLanguage, now, channelId, anilistUserId]
            );
            
            // Checkpoint to persist profile updates
            await db.exec("PRAGMA wal_checkpoint(PASSIVE);");
            
            // Update memory cache
            trackedUsers[channelId][anilistUserId].userAvatar = currentAvatar;
            trackedUsers[channelId][anilistUserId].userColor = currentColor;
            trackedUsers[channelId][anilistUserId].titleLanguage = currentTitleLanguage;
            trackedUsers[channelId][anilistUserId].profileLastUpdated = now;
            
            console.log(`✓ Refreshed profile data for ${anilistUsername}`);
        }
        
        const activityData = data.data;

        if (
            activityData?.Page?.activities &&
            activityData.Page.activities.length > 0
        ) {
            const activities = activityData.Page.activities;

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
                    const embedColor = currentColor 
                        ? (anilistColorMap[currentColor.toLowerCase()] || "#C3B1E1")
                        : "#C3B1E1";
                    
                    for (const activity of activitiesToShow) {
                        const mediaTitle = getPreferredTitle(activity.media.title, currentTitleLanguage);
                        
                        // Build description
                        const description = `${activity.status} ${activity.progress || ""} - **[${mediaTitle}](${activity.media.siteUrl})**`;
                        
                        const embed = new EmbedBuilder()
                            .setColor(embedColor)
                            .setAuthor({
                                name: `${anilistUsername}'s Activity`,
                                iconURL: currentAvatar,
                                url: `https://anilist.co/user/${anilistUsername}/`,
                            })
                            .setDescription(description)
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
                
                // Force checkpoint to ensure data is persisted
                await db.exec("PRAGMA wal_checkpoint(PASSIVE);");
                
                // Verify the write was successful
                const verification = await db.get(
                    `SELECT lastActivityId FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`,
                    [channelId, anilistUserId]
                );
                
                if (verification && verification.lastActivityId === mostRecentActivityId) {
                    trackedUsers[channelId][anilistUserId].lastActivityId =
                        mostRecentActivityId;
                    console.log(
                        `✓ Updated lastActivityId to ${mostRecentActivityId} for ${anilistUsername} in DB (verified).`,
                    );
                } else {
                    console.error(
                        `✗ Database write verification failed for ${anilistUsername}! Expected ${mostRecentActivityId}, got ${verification?.lastActivityId}`,
                    );
                }
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
    const userCount = Object.keys(trackedUsers).reduce((total, channelId) => {
        return total + Object.keys(trackedUsers[channelId]).length;
    }, 0);
    
    console.log(`Checking for new AniList activity (initial check)... Found ${userCount} tracked users.`);
    
    for (const channelId in trackedUsers) {
        for (const anilistUserId in trackedUsers[channelId]) {
            console.log(`Initial check: ${trackedUsers[channelId][anilistUserId].anilistUsername}`);
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
    
    // Periodic database checkpoint every 30 minutes to ensure persistence
    setInterval(async () => {
        try {
            await db.exec("PRAGMA wal_checkpoint(PASSIVE);");
            console.log("✓ Database checkpoint completed.");
        } catch (error) {
            console.error("Database checkpoint error:", error);
        }
    }, 1800000); // 30 minutes
});

// slash commands handle karte hain
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    try {
        // ephemeral replies ke liye flags use karte hain
        await interaction.deferReply({
            flags: ["list", "help", "untrack", "stats", "serverstats"].includes(commandName)
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
                    {
                        name: "/stats <username>",
                        value: "Shows detailed statistics for an AniList user.",
                    },
                    {
                        name: "/serverstats",
                        value: "Shows statistics for all tracked users in this server.",
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
            
            // Fetch user ID and profile data in one query
            const findUserQuery = `query ($username: String) { 
                User(name: $username) { 
                    id 
                    avatar { large }
                    options { profileColor, titleLanguage }
                } 
            }`;
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
            const userAvatar = data.data.User.avatar?.large;
            const userColor = data.data.User.options?.profileColor;
            const titleLanguage = data.data.User.options?.titleLanguage || "ROMAJI";
            const now = Date.now();
            
            if (trackedUsers[channelId]?.[anilistUserId])
                return interaction.editReply(
                    `**${anilistUsername}** is already being tracked in this channel.`,
                );
            
            const sql = `INSERT INTO tracked_users (channelId, anilistUsername, anilistUserId, lastActivityId, userAvatar, userColor, titleLanguage, profileLastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
            await db.run(sql, [
                channelId,
                anilistUsername,
                anilistUserId,
                null,
                userAvatar,
                userColor,
                titleLanguage,
                now,
            ]);
            
            // Force checkpoint to ensure data is persisted to main database file
            await db.exec("PRAGMA wal_checkpoint(FULL);");
            
            // Verify the insert was successful
            const verification = await db.get(
                `SELECT * FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`,
                [channelId, anilistUserId]
            );
            
            if (verification) {
                console.log(
                    `✓ [SUCCESS] Database write for ${anilistUsername} completed and verified.`,
                );
                if (!trackedUsers[channelId]) trackedUsers[channelId] = {};
                trackedUsers[channelId][anilistUserId] = {
                    anilistUsername: anilistUsername,
                    lastActivityId: null,
                    userAvatar: userAvatar,
                    userColor: userColor,
                    titleLanguage: titleLanguage,
                    profileLastUpdated: now,
                };
            } else {
                console.error(
                    `✗ [ERROR] Database write verification failed for ${anilistUsername}!`,
                );
                throw new Error("Failed to persist user to database");
            }
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
            
            // Force checkpoint to ensure deletion is persisted
            await db.exec("PRAGMA wal_checkpoint(FULL);");
            
            // Verify the delete was successful
            const verification = await db.get(
                `SELECT * FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`,
                [channelId, userIdToUntrack]
            );
            
            if (!verification) {
                console.log(
                    `✓ Successfully deleted ${userToUntrackInfo.anilistUsername} from database (verified).`,
                );
                delete trackedUsers[channelId][userIdToUntrack];
                if (Object.keys(trackedUsers[channelId]).length === 0)
                    delete trackedUsers[channelId];
                await interaction.editReply(
                    `Stopped tracking **${userToUntrackInfo.anilistUsername}** in this channel.`,
                );
            } else {
                console.error(
                    `✗ Database delete verification failed for ${userToUntrackInfo.anilistUsername}!`,
                );
                await interaction.editReply(
                    `Error: Failed to remove **${userToUntrackInfo.anilistUsername}** from database.`,
                );
            }
        } else if (commandName === "stats") {
            const anilistUsername = interaction.options.getString("username");
            
            // Fetch comprehensive user statistics
            const statsQuery = `query ($username: String) {
                User(name: $username) {
                    id
                    name
                    avatar { large }
                    bannerImage
                    statistics {
                        anime {
                            count
                            episodesWatched
                            minutesWatched
                            meanScore
                            standardDeviation
                        }
                        manga {
                            count
                            chaptersRead
                            volumesRead
                            meanScore
                            standardDeviation
                        }
                    }
                    favourites {
                        anime { nodes { title { romaji } } }
                        manga { nodes { title { romaji } } }
                        characters { nodes { name { full } } }
                    }
                }
            }`;
            
            try {
                const response = await fetch("https://graphql.anilist.co", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({
                        query: statsQuery,
                        variables: { username: anilistUsername },
                    }),
                });
                
                const data = await response.json();
                
                if (!data.data || !data.data.User) {
                    return interaction.editReply(
                        `Could not find an AniList user with the username **${anilistUsername}**.`
                    );
                }
                
                const user = data.data.User;
                const animeStats = user.statistics.anime;
                const mangaStats = user.statistics.manga;
                
                // Calculate days watched
                const daysWatched = (animeStats.minutesWatched / 1440).toFixed(1);
                
                // Get favorite anime (top 3)
                const favAnime = user.favourites.anime.nodes
                    .slice(0, 3)
                    .map(a => a.title.romaji)
                    .join(", ") || "None";
                
                // Get favorite manga (top 3)
                const favManga = user.favourites.manga.nodes
                    .slice(0, 3)
                    .map(m => m.title.romaji)
                    .join(", ") || "None";
                
                // Get favorite character
                const favChar = user.favourites.characters.nodes[0]?.name.full || "None";
                
                const statsEmbed = new EmbedBuilder()
                    .setColor("#C3B1E1")
                    .setAuthor({
                        name: `${user.name}'s AniList Statistics`,
                        iconURL: user.avatar.large,
                        url: `https://anilist.co/user/${user.name}/`,
                    })
                    .addFields(
                        {
                            name: "📺 Anime Statistics",
                            value: [
                                `**Total Anime:** ${animeStats.count}`,
                                `**Episodes Watched:** ${animeStats.episodesWatched.toLocaleString()}`,
                                `**Days Watched:** ${daysWatched}`,
                                `**Mean Score:** ${animeStats.meanScore.toFixed(1)}`,
                            ].join("\n"),
                            inline: true,
                        },
                        {
                            name: "📖 Manga Statistics",
                            value: [
                                `**Total Manga:** ${mangaStats.count}`,
                                `**Chapters Read:** ${mangaStats.chaptersRead.toLocaleString()}`,
                                `**Volumes Read:** ${mangaStats.volumesRead.toLocaleString()}`,
                                `**Mean Score:** ${mangaStats.meanScore.toFixed(1)}`,
                            ].join("\n"),
                            inline: true,
                        },
                        {
                            name: "⭐ Favorites",
                            value: [
                                `**Anime:** ${favAnime}`,
                                `**Manga:** ${favManga}`,
                                `**Character:** ${favChar}`,
                            ].join("\n"),
                        }
                    );
                
                if (user.bannerImage) {
                    statsEmbed.setImage(user.bannerImage);
                }
                
                await interaction.editReply({ embeds: [statsEmbed] });
            } catch (error) {
                console.error(`Error fetching stats for ${anilistUsername}:`, error);
                await interaction.editReply(
                    `There was an error fetching statistics for **${anilistUsername}**.`
                );
            }
        } else if (commandName === "serverstats") {
            // Collect all unique users tracked in this server (across all channels)
            const guildId = interaction.guildId;
            const allChannelsInGuild = Object.keys(trackedUsers);
            const uniqueUsers = new Map();
            
            // Gather all unique tracked users in this guild
            for (const channelId of allChannelsInGuild) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    if (channel && channel.guildId === guildId) {
                        for (const userId in trackedUsers[channelId]) {
                            const user = trackedUsers[channelId][userId];
                            if (!uniqueUsers.has(userId)) {
                                uniqueUsers.set(userId, user.anilistUsername);
                            }
                        }
                    }
                } catch (error) {
                    // Channel might not be accessible, skip it
                    continue;
                }
            }
            
            if (uniqueUsers.size === 0) {
                return interaction.editReply(
                    "No users are currently being tracked in this server."
                );
            }
            
            // Fetch statistics for all tracked users
            const userIds = Array.from(uniqueUsers.keys());
            const batchQuery = `query ($ids: [Int]) {
                Page(page: 1, perPage: 50) {
                    users(id_in: $ids) {
                        id
                        name
                        statistics {
                            anime {
                                count
                                episodesWatched
                                minutesWatched
                                meanScore
                            }
                            manga {
                                count
                                chaptersRead
                            }
                        }
                    }
                }
            }`;
            
            try {
                const response = await fetch("https://graphql.anilist.co", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                    body: JSON.stringify({
                        query: batchQuery,
                        variables: { ids: userIds.map(id => parseInt(id)) },
                    }),
                });
                
                const data = await response.json();
                
                if (!data.data || !data.data.Page.users) {
                    return interaction.editReply(
                        "There was an error fetching server statistics."
                    );
                }
                
                const users = data.data.Page.users;
                
                // Calculate aggregate statistics
                let totalAnime = 0;
                let totalEpisodes = 0;
                let totalManga = 0;
                let totalChapters = 0;
                let totalMinutes = 0;
                let avgScore = 0;
                
                users.forEach(user => {
                    totalAnime += user.statistics.anime.count;
                    totalEpisodes += user.statistics.anime.episodesWatched;
                    totalManga += user.statistics.manga.count;
                    totalChapters += user.statistics.manga.chaptersRead;
                    totalMinutes += user.statistics.anime.minutesWatched;
                    avgScore += user.statistics.anime.meanScore;
                });
                
                avgScore = (avgScore / users.length).toFixed(1);
                const totalDays = (totalMinutes / 1440).toFixed(1);
                
                // Find top watchers
                const topWatchers = users
                    .sort((a, b) => b.statistics.anime.count - a.statistics.anime.count)
                    .slice(0, 5)
                    .map((u, i) => `${i + 1}. **${u.name}** - ${u.statistics.anime.count} anime`)
                    .join("\n");
                
                const serverStatsEmbed = new EmbedBuilder()
                    .setColor("#C3B1E1")
                    .setTitle(`📊 Server AniList Statistics`)
                    .setDescription(`Tracking **${uniqueUsers.size}** users in this server`)
                    .addFields(
                        {
                            name: "📺 Combined Anime Stats",
                            value: [
                                `**Total Anime Watched:** ${totalAnime.toLocaleString()}`,
                                `**Total Episodes:** ${totalEpisodes.toLocaleString()}`,
                                `**Total Days Watched:** ${totalDays}`,
                                `**Average Score:** ${avgScore}`,
                            ].join("\n"),
                            inline: true,
                        },
                        {
                            name: "📖 Combined Manga Stats",
                            value: [
                                `**Total Manga Read:** ${totalManga.toLocaleString()}`,
                                `**Total Chapters:** ${totalChapters.toLocaleString()}`,
                            ].join("\n"),
                            inline: true,
                        },
                        {
                            name: "🏆 Top Watchers",
                            value: topWatchers,
                        }
                    )
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [serverStatsEmbed] });
            } catch (error) {
                console.error("Error fetching server stats:", error);
                await interaction.editReply(
                    "There was an error fetching server statistics."
                );
            }
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
        
        // Enable WAL mode for better concurrent access and prevent corruption
        await db.exec("PRAGMA journal_mode = WAL;");
        
        await db.exec(
            `CREATE TABLE IF NOT EXISTS tracked_users (
                channelId TEXT NOT NULL, 
                anilistUserId INTEGER NOT NULL, 
                anilistUsername TEXT NOT NULL, 
                lastActivityId INTEGER,
                userAvatar TEXT,
                userColor TEXT,
                titleLanguage TEXT DEFAULT 'ROMAJI',
                profileLastUpdated INTEGER,
                PRIMARY KEY (channelId, anilistUserId)
            )`,
        );
        console.log("tracked_users table is ready.");
        
        // Migration: Add new columns if they don't exist (for existing databases)
        const tableInfo = await db.all("PRAGMA table_info(tracked_users)");
        const columnNames = tableInfo.map(col => col.name);
        
        if (!columnNames.includes('userAvatar')) {
            await db.exec(`ALTER TABLE tracked_users ADD COLUMN userAvatar TEXT`);
            console.log("✓ Added userAvatar column");
        }
        if (!columnNames.includes('userColor')) {
            await db.exec(`ALTER TABLE tracked_users ADD COLUMN userColor TEXT`);
            console.log("✓ Added userColor column");
        }
        if (!columnNames.includes('titleLanguage')) {
            await db.exec(`ALTER TABLE tracked_users ADD COLUMN titleLanguage TEXT DEFAULT 'ROMAJI'`);
            console.log("✓ Added titleLanguage column");
        }
        if (!columnNames.includes('profileLastUpdated')) {
            await db.exec(`ALTER TABLE tracked_users ADD COLUMN profileLastUpdated INTEGER`);
            console.log("✓ Added profileLastUpdated column");
        }
        
        // Checkpoint after migration
        await db.exec("PRAGMA wal_checkpoint(FULL);");
        
        // Load data from database with detailed logging
        const rows = await db.all("SELECT * FROM tracked_users");
        console.log(`\n=== DATABASE LOAD START ===`);
        console.log(`Found ${rows.length} tracked entries in database.`);
        
        rows.forEach((row, index) => {
            if (!trackedUsers[row.channelId]) trackedUsers[row.channelId] = {};
            trackedUsers[row.channelId][row.anilistUserId] = {
                anilistUsername: row.anilistUsername,
                lastActivityId: row.lastActivityId,
                userAvatar: row.userAvatar,
                userColor: row.userColor,
                titleLanguage: row.titleLanguage || "ROMAJI",
                profileLastUpdated: row.profileLastUpdated,
            };
            console.log(`  [${index + 1}] User: ${row.anilistUsername} (ID: ${row.anilistUserId}), LastActivityId: ${row.lastActivityId}, Channel: ${row.channelId}`);
        });
        
        console.log(`=== DATABASE LOAD COMPLETE ===\n`);
        console.log("Database loaded. Logging into Discord...");
        client.login(token);
    } catch (error) {
        console.error("Failed to start the bot:", error);
        process.exit(1);
    }
}

// Graceful shutdown handling to ensure database persists
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Closing database and shutting down gracefully...`);
    try {
        // Final checkpoint to flush all changes to main database file
        await db.exec("PRAGMA wal_checkpoint(FULL);");
        await db.close();
        console.log("✓ Database closed successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
    }
}

// Handle various termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// bot shuru karte hain
startBot();
