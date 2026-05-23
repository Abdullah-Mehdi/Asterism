// sqlite async/await ke liye
const { open } = require("sqlite");
const sqlite3 = require("sqlite3").verbose();

const { token } = require("./config.json");

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    MessageFlags,
    PermissionsBitField,
} = require("discord.js");
// Node 20+ provides a global `fetch` — no node-fetch dep needed.
const fs = require("fs");
const path = require("path");

// =========================================================================
// Single-instance lock
// =========================================================================

// Lock file persistent storage path par rakhte hain (Replit deployments survive redeploys).
const LOCK_FILE = process.env.REPL_HOME ?
    path.join(process.env.REPL_HOME, 'bot.lock') :
    path.join(__dirname, 'bot.lock');

/**
 * Acquire a process-wide lock at LOCK_FILE so only one bot instance runs.
 * If a live PID already owns the lock, exits with code 1.
 * Stale locks (PID no longer alive) are cleared and re-acquired.
 * Wires `exit`, `SIGINT`, `SIGTERM`, and `SIGQUIT` to clean up the lock.
 */
function checkSingleInstance() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lockPid = fs.readFileSync(LOCK_FILE, 'utf8');
            try {
                // Signal 0 = "is the process alive?" without actually killing it.
                process.kill(lockPid, 0);
                console.error(`❌ Another instance is already running (PID: ${lockPid}). Exiting...`);
                process.exit(1);
            } catch (e) {
                // Process gone, lock file stale — clear it and continue.
                console.log('🔧 Removing stale lock file...');
                fs.unlinkSync(LOCK_FILE);
            }
        }

        fs.writeFileSync(LOCK_FILE, process.pid.toString());
        console.log(`✓ Lock acquired (PID: ${process.pid})`);

        process.on('exit', () => {
            try {
                fs.unlinkSync(LOCK_FILE);
            } catch (e) {
                // Cleanup-only path; swallow errors.
            }
        });

        ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
            process.on(signal, () => {
                console.log(`\n${signal} received, cleaning up...`);
                try {
                    fs.unlinkSync(LOCK_FILE);
                } catch (e) {
                    // Cleanup-only path; swallow errors.
                }
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('Error setting up single instance lock:', error);
        process.exit(1);
    }
}

// Lock acquisition is at top-level (not inside startBot) so it runs before
// any other module-level work and rejects double-spawns immediately.
checkSingleInstance();

// agar koi promise reject ho jaye to bot crash na ho
process.on("unhandledRejection", (error) => {
    console.error("CRITICAL: Unhandled Promise Rejection:", error);
    // error log kar dete hain lekin bot ko crash nahi karte
});

// =========================================================================
// Globals & Discord client
// =========================================================================

let trackedUsers = {}; // memory mein users ka data rakhe ga
let db; // database ka instance
let webhookCache = {}; // channelId -> Webhook
const PROFILE_CACHE_DURATION = 86400000; // 24 hours in ms

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

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// =========================================================================
// Helpers
// =========================================================================

/**
 * Pick the title field that matches the user's AniList language preference.
 * Falls back through romaji → english → native if the requested field is empty.
 */
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

// =========================================================================
// Webhook delivery
// =========================================================================

/**
 * Return a cached or freshly created "AniList Activity" webhook for the given channel.
 * Returns null if the bot lacks MANAGE_WEBHOOKS in the channel, or if creation/fetch fails.
 * Cached webhooks are revalidated on each call; deleted webhooks are evicted automatically.
 */
async function getOrCreateWebhook(channel) {
    if (webhookCache[channel.id]) {
        try {
            // Revalidate — webhook may have been deleted out from under us.
            await webhookCache[channel.id].fetch();
            return webhookCache[channel.id];
        } catch (error) {
            delete webhookCache[channel.id];
        }
    }

    try {
        const permissions = channel.permissionsFor(client.user);
        if (!permissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
            console.warn(`⚠️ Missing MANAGE_WEBHOOKS permission in channel ${channel.id}`);
            return null;
        }

        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner?.id === client.user.id && wh.name === 'AniList Activity');

        if (!webhook) {
            webhook = await channel.createWebhook({
                name: 'AniList Activity',
                reason: 'For posting AniList activity updates',
            });
            console.log(`✓ Created webhook for channel ${channel.id}`);
        }

        webhookCache[channel.id] = webhook;
        return webhook;
    } catch (error) {
        console.error(`Error managing webhook for channel ${channel.id}:`, error.message);
        return null;
    }
}

/**
 * Send an activity embed to a channel.
 * Prefers webhook delivery (so the post wears the AniList user's name/avatar);
 * falls back to a regular bot message if the webhook is missing or fails.
 * Returns true if the post went through a webhook, false if it fell back.
 */
async function sendActivityUpdate(channel, anilistUsername, userAvatar, embed) {
    let messageSent = false;

    try {
        const webhook = await getOrCreateWebhook(channel);

        if (webhook) {
            try {
                await webhook.send({
                    username: anilistUsername,
                    avatarURL: userAvatar || undefined,
                    embeds: [embed],
                });
                return true;
            } catch (webhookError) {
                console.error(`Webhook send failed, falling back to regular message:`, webhookError.message);
                delete webhookCache[channel.id];
                // Fall through to the plain channel.send below.
            }
        }

        // No webhook (or webhook send failed) — send as the bot.
        messageSent = true; // mark before send, so the catch below knows we already tried
        await channel.send({ embeds: [embed] });
        return false;

    } catch (error) {
        console.error(`Error in sendActivityUpdate:`, error.message);
        // Only retry if the regular-message branch hasn't been attempted yet.
        if (!messageSent) {
            try {
                await channel.send({ embeds: [embed] });
            } catch (fallbackError) {
                console.error(`Failed to send message:`, fallbackError.message);
            }
        }
        return false;
    }
}

// =========================================================================
// AniList polling
// =========================================================================

/**
 * Poll AniList for one tracked (channelId, anilistUserId) pair and post any new
 * list activity to the channel. Builds a single combined GraphQL query that also
 * refreshes profile data (avatar, color, title language) once per PROFILE_CACHE_DURATION.
 *
 * Posts at most 15 activities per call (oldest first), filtered by the user's
 * anime/manga/both preference. Always advances lastActivityId to the newest
 * fetched activity even if the filter dropped it, so filtered-out items aren't
 * re-evaluated next tick.
 */
async function checkAniListActivity(channelId, anilistUserId) {
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return;

    const { anilistUsername, lastActivityId, userAvatar, userColor, titleLanguage, profileLastUpdated, activityFilter } = trackingInfo;
    const url = "https://graphql.anilist.co";
    const filter = activityFilter || "both";
    const now = Date.now();

    // Profile data 24h baad refresh karte hain — saves ~98% of profile-only API calls.
    const needsProfileRefresh = !profileLastUpdated || (now - profileLastUpdated) > PROFILE_CACHE_DURATION;

    try {
        let currentAvatar = userAvatar;
        let currentColor = userColor;
        let currentTitleLanguage = titleLanguage || "ROMAJI";

        // Combined query: profile + activities in ONE request when refresh is due,
        // activities-only otherwise.
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
                                type
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
                                type
                                title { romaji, english, native }, 
                                coverImage { large }, 
                                siteUrl 
                            } 
                        } 
                    } 
                }
            }`;

        const variables = { userId: anilistUserId };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ query: combinedQuery, variables }),
        });
        const data = await response.json();

        if (!data || !data.data) {
            console.error(`✗ Invalid API response for ${anilistUsername}:`, data?.errors || "Unknown error");
            return;
        }

        if (needsProfileRefresh && data.data?.User) {
            currentAvatar = data.data.User.avatar?.large;
            currentColor = data.data.User.options?.profileColor;
            currentTitleLanguage = data.data.User.options?.titleLanguage || "ROMAJI";

            await db.run(
                `UPDATE tracked_users SET userAvatar = ?, userColor = ?, titleLanguage = ?, profileLastUpdated = ? WHERE channelId = ? AND anilistUserId = ?`,
                [currentAvatar, currentColor, currentTitleLanguage, now, channelId, anilistUserId]
            );

            // Checkpoint so a sudden kill doesn't lose the profile refresh.
            await db.exec("PRAGMA wal_checkpoint(PASSIVE);");

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

            // Naye activities = jin ki id last seen se badi hai.
            // Pehli baar (`lastActivityId == null`) sirf latest ek hi post karte hain
            // taake pura backlog flood na ho.
            let newActivities = lastActivityId
                ? activities.filter((activity) => activity.id > lastActivityId)
                : [activities[0]];

            if (filter === 'anime') {
                newActivities = newActivities.filter(activity => activity.media.type === 'ANIME');
            } else if (filter === 'manga') {
                newActivities = newActivities.filter(activity => activity.media.type === 'MANGA');
            }
            // 'both' => no filter

            if (newActivities.length > 0) {
                // 15 ka cap so a long absence can't dump 50 posts at once.
                const activitiesToShow = newActivities.slice(0, 15);
                const skippedCount = newActivities.length - activitiesToShow.length;

                console.log(
                    `${newActivities.length} new activity/activities for ${anilistUsername}` +
                    (skippedCount > 0 ? ` (showing ${activitiesToShow.length}, skipping ${skippedCount} older ones)` : ''),
                );
                const channel = await client.channels.fetch(channelId);

                if (channel) {
                    // Post oldest-first so the channel reads chronologically.
                    activitiesToShow.reverse();

                    const embedColor = currentColor
                        ? (anilistColorMap[currentColor.toLowerCase()] || "#C3B1E1")
                        : "#C3B1E1";

                    for (const activity of activitiesToShow) {
                        const mediaTitle = getPreferredTitle(activity.media.title, currentTitleLanguage);

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
                            .setFooter({
                                text: "Asterism • From AniList",
                                iconURL: client.user.displayAvatarURL()
                            });

                        await sendActivityUpdate(channel, anilistUsername, currentAvatar, embed);
                    }
                }

                // Watermark advances to the newest fetched activity (even if filter
                // dropped it) so we never re-evaluate the same items.
                const mostRecentActivityId = activities[0].id;
                const sql = `UPDATE tracked_users SET lastActivityId = ? WHERE channelId = ? AND anilistUserId = ?`;
                await db.run(sql, [
                    mostRecentActivityId,
                    channelId,
                    anilistUserId,
                ]);

                await db.exec("PRAGMA wal_checkpoint(PASSIVE);");

                // Read-back verification — DB write must stick before we trust memory.
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

// =========================================================================
// Ready handler — initial check + intervals
// =========================================================================

client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);

    client.user.setActivity('/help');

    // Immediate startup check so newly redeployed bots don't wait 10 minutes
    // before posting.
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

    // har 10 minute mein check karte hain
    setInterval(() => {
        console.log("Checking for new AniList activity...");
        for (const channelId in trackedUsers) {
            for (const anilistUserId in trackedUsers[channelId]) {
                checkAniListActivity(channelId, anilistUserId);
            }
        }
    }, 600000);

    // Periodic checkpoint so WAL doesn't grow unbounded between writes.
    setInterval(async () => {
        try {
            await db.exec("PRAGMA wal_checkpoint(PASSIVE);");
            console.log("✓ Database checkpoint completed.");
        } catch (error) {
            console.error("Database checkpoint error:", error);
        }
    }, 1800000); // 30 minutes
});

// =========================================================================
// Slash command dispatcher
// =========================================================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    try {
        // /list, /help, /untrack are management — keep them ephemeral.
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
                        name: "/track <username> [filter]",
                        value: "Starts tracking a user's activity. Optional filter: anime, manga, or both (default).",
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
                        .map((user) => {
                            const filterEmoji = user.activityFilter === 'anime' ? '📺' :
                                              user.activityFilter === 'manga' ? '📖' : '📺📖';
                            const filterText = user.activityFilter === 'both' ? '' :
                                             ` (${user.activityFilter} only)`;
                            return `• ${filterEmoji} **${user.anilistUsername}**${filterText}`;
                        })
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
            const activityFilter = interaction.options.getString("filter") || "both";
            const channelId = interaction.channelId;

            // Lookup ID + profile (avatar/color/titleLanguage) in a single query.
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

            const sql = `INSERT INTO tracked_users (channelId, anilistUsername, anilistUserId, lastActivityId, userAvatar, userColor, titleLanguage, profileLastUpdated, activityFilter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            await db.run(sql, [
                channelId,
                anilistUsername,
                anilistUserId,
                null,
                userAvatar,
                userColor,
                titleLanguage,
                now,
                activityFilter,
            ]);

            // FULL checkpoint — user-facing write, must survive a kill.
            await db.exec("PRAGMA wal_checkpoint(FULL);");

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
                    activityFilter: activityFilter,
                };
            } else {
                console.error(
                    `✗ [ERROR] Database write verification failed for ${anilistUsername}!`,
                );
                throw new Error("Failed to persist user to database");
            }
            const filterText = activityFilter === 'both' ? 'all activity' :
                              activityFilter === 'anime' ? 'anime only' : 'manga only';
            await interaction.editReply(
                `Successfully found **${anilistUsername}**. Now tracking their ${filterText} in this channel!`,
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

            // FULL checkpoint — user-facing write, must survive a kill.
            await db.exec("PRAGMA wal_checkpoint(FULL);");

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

                const daysWatched = (animeStats.minutesWatched / 1440).toFixed(1);

                const favAnime = user.favourites.anime.nodes
                    .slice(0, 3)
                    .map(a => a.title.romaji)
                    .join(", ") || "None";

                const favManga = user.favourites.manga.nodes
                    .slice(0, 3)
                    .map(m => m.title.romaji)
                    .join(", ") || "None";

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
            // Collect every unique AniList user tracked anywhere in this guild
            // (a user may be tracked in multiple channels — dedupe by AniList ID).
            const guildId = interaction.guildId;
            const allChannelsInGuild = Object.keys(trackedUsers);
            const uniqueUsers = new Map();

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
                    // Channel inaccessible — skip silently and continue.
                    continue;
                }
            }

            if (uniqueUsers.size === 0) {
                return interaction.editReply(
                    "No users are currently being tracked in this server."
                );
            }

            const userIds = Array.from(uniqueUsers.keys());
            console.log(`Fetching server stats for ${userIds.length} users:`, userIds);

            // AniList's schema doesn't expose a multi-User field, so we fan out
            // one query per user and Promise.all the lot.
            const userDataPromises = userIds.map(async (userId) => {
                const userQuery = `query ($id: Int) {
                    User(id: $id) {
                        id
                        name
                        avatar {
                            medium
                        }
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
                }`;

                try {
                    const response = await fetch("https://graphql.anilist.co", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        body: JSON.stringify({
                            query: userQuery,
                            variables: { id: parseInt(userId) },
                        }),
                    });

                    const data = await response.json();
                    return data.data?.User || null;
                } catch (error) {
                    console.error(`Error fetching user ${userId}:`, error);
                    return null;
                }
            });

            try {
                const usersData = await Promise.all(userDataPromises);
                const users = usersData.filter(u => u !== null);

                if (users.length === 0) {
                    return interaction.editReply(
                        "No data available for tracked users in this server."
                    );
                }

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

                const topWatchers = users
                    .sort((a, b) => b.statistics.anime.count - a.statistics.anime.count)
                    .slice(0, 5)
                    .map((u, i) => {
                        const avatarEmoji = u.avatar?.medium ? `[🎭](${u.avatar.medium})` : '👤';
                        return `${i + 1}. ${avatarEmoji} **[${u.name}](https://anilist.co/user/${u.name})** - ${u.statistics.anime.count} anime`;
                    })
                    .join("\n");

                const topUser = users.sort((a, b) => b.statistics.anime.count - a.statistics.anime.count)[0];

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
                    .setThumbnail(topUser?.avatar?.medium || null)
                    .setTimestamp();

                await interaction.editReply({ embeds: [serverStatsEmbed] });
            } catch (error) {
                console.error("Error fetching server stats:", error.message, error.stack);
                await interaction.editReply(
                    `There was an error fetching server statistics: ${error.message}`
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

// =========================================================================
// Startup — database open, migrations, hydration, login
// =========================================================================

/**
 * Open the SQLite database (WAL mode), apply idempotent migrations,
 * hydrate the in-memory `trackedUsers` cache, and log into Discord.
 * Uses $REPL_HOME/bot.db when running on Replit, ./bot.db locally.
 */
async function startBot() {
    try {
        // Persistent storage on Replit so the DB survives redeploys.
        const dbPath = process.env.REPL_HOME ?
            path.join(process.env.REPL_HOME, 'bot.db') : './bot.db';

        console.log(`Database path: ${dbPath}`);
        db = await open({ filename: dbPath, driver: sqlite3.Database });
        console.log("Connected to the SQLite database.");

        // WAL mode = better concurrent reads + crash resistance.
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
                activityFilter TEXT DEFAULT 'both',
                PRIMARY KEY (channelId, anilistUserId)
            )`,
        );
        console.log("tracked_users table is ready.");

        // Idempotent migrations — `ADD COLUMN` only when not already present.
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
        if (!columnNames.includes('activityFilter')) {
            await db.exec(`ALTER TABLE tracked_users ADD COLUMN activityFilter TEXT DEFAULT 'both'`);
            console.log("✓ Added activityFilter column");
        }

        await db.exec("PRAGMA wal_checkpoint(FULL);");

        // Hydrate trackedUsers cache from disk.
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
                activityFilter: row.activityFilter || "both",
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

// =========================================================================
// Graceful shutdown
// =========================================================================

/**
 * Final WAL checkpoint, close the database, and remove the lock file.
 * Wired to SIGHUP only — SIGINT/SIGTERM/SIGQUIT are handled in checkSingleInstance().
 */
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Closing database and shutting down gracefully...`);
    try {
        if (db) {
            await db.exec("PRAGMA wal_checkpoint(FULL);");
            await db.close();
            console.log("✓ Database closed successfully.");
        }

        try {
            fs.unlinkSync(LOCK_FILE);
            console.log("✓ Lock file removed.");
        } catch (e) {
            // Lock already gone — ignore.
        }

        process.exit(0);
    } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(1);
    }
}

process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// bot shuru karte hain
startBot();
