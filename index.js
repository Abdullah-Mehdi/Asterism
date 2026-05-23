// @ts-check
// sqlite async/await ke liye
const { open } = require("sqlite");
const sqlite3 = require("sqlite3").verbose();

// Token can come from Replit Secrets (env) or config.json. Env wins.
// config.json is now optional — missing file is fine if env is set.
/** @type {{ token?: string }} */
let _configFile = {};
// @ts-ignore — config.json is gitignored, so it may not exist at type-check time;
// the try/catch handles the runtime "missing file" case.
try { _configFile = require("./config.json"); } catch { /* file optional */ }
const token = process.env.DISCORD_TOKEN ?? _configFile.token;
if (!token) {
    console.error("✗ Missing DISCORD_TOKEN — set it in Replit Secrets, env, or config.json.");
    process.exit(1);
}

const {
    Client,
    Events,
    GatewayIntentBits,
    EmbedBuilder,
    MessageFlags,
    PermissionsBitField,
} = require("discord.js");
// Node 20+ provides a global `fetch` — no node-fetch dep needed.
const fs = require("fs");
const path = require("path");

const { aniListFetch } = require("./lib/anilist");
const commands = require("./commands");
const commandMap = new Map(commands.map(c => [c.data.name, c]));

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
 * Wires `process.on('exit')` as a last-resort lock-unlink fallback;
 * termination signals (SIGINT/SIGTERM/SIGQUIT/SIGHUP) are routed to
 * `gracefulShutdown` separately at the bottom of the file.
 */
function checkSingleInstance() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lockPid = fs.readFileSync(LOCK_FILE, 'utf8');
            try {
                // Signal 0 = "is the process alive?" without actually killing it.
                process.kill(parseInt(lockPid, 10), 0);
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

        // Last-resort lock cleanup — fires even if gracefulShutdown died mid-run.
        // Termination signals (SIGINT/SIGTERM/SIGQUIT/SIGHUP) are wired to
        // gracefulShutdown at the bottom of the file so the WAL gets a final
        // checkpoint and the DB closes cleanly before we hit this path.
        process.on('exit', () => {
            try {
                fs.unlinkSync(LOCK_FILE);
            } catch (e) {
                // Cleanup-only path; swallow errors.
            }
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

/** @type {Object<string, Object<string, import("./lib/types").TrackedUser>>} */
let trackedUsers = {}; // memory mein users ka data rakhe ga
/** @type {any} */
let db; // database ka instance (sqlite Database — no exported type)
/** @type {Object<string, import("discord.js").Webhook>} */
let webhookCache = {}; // channelId -> Webhook
/** @type {Object<string, import("./lib/types").ChannelPermissionsEntry>} */
let permissionsCache = {}; // channelId -> { hasManageWebhooks, expiresAt }
// Tracks (channelId:anilistUserId) pairs whose first successful poll has
// already happened in *this* process. Re-armed by every restart, which is
// the whole point: any backlog accumulated during downtime gets summarised
// down to a single post per user instead of flooding the channel.
/** @type {Set<string>} */
const firstPollComplete = new Set();
const PROFILE_CACHE_DURATION = 86400000; // 24 hours in ms
const PERMISSIONS_CACHE_TTL = 3600000; // 1 hour — channel perms drift slowly

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
    // Narrow once in a local — TS doesn't preserve the null-check across the
    // closures below.
    const botUser = client.user;
    if (!botUser) return null;
    if (webhookCache[channel.id]) {
        try {
            // Revalidate — webhook may have been deleted out from under us.
            // @ts-ignore — Webhook.fetch() exists at runtime; v14 types omit it
            await webhookCache[channel.id].fetch();
            return webhookCache[channel.id];
        } catch (error) {
            delete webhookCache[channel.id];
        }
    }

    try {
        // Permissions check is cached per channel to avoid recomputing role math
        // on every poll. 1 hour TTL — perms changes lag a tick at most.
        const now = Date.now();
        const cached = permissionsCache[channel.id];
        let hasManageWebhooks;
        if (cached && cached.expiresAt > now) {
            hasManageWebhooks = cached.hasManageWebhooks;
        } else {
            hasManageWebhooks = channel.permissionsFor(botUser)
                .has(PermissionsBitField.Flags.ManageWebhooks);
            permissionsCache[channel.id] = {
                hasManageWebhooks,
                expiresAt: now + PERMISSIONS_CACHE_TTL,
            };
        }
        if (!hasManageWebhooks) {
            console.warn(`⚠️ Missing MANAGE_WEBHOOKS permission in channel ${channel.id}`);
            return null;
        }

        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner?.id === botUser.id && wh.name === 'AniList Activity');

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
    if (!client.user) return; // before ready — narrow for TS, also defensive
    const trackingInfo = trackedUsers[channelId]?.[anilistUserId];
    if (!trackingInfo) return;

    // Defensive: activityFilter is the one field where stale memory would
    // silently produce wrong-channel posts (anime activity in a manga-only
    // channel and vice versa). Treat the DB as canonical for it on every
    // poll and reconcile if drift is detected.
    try {
        const dbRow = await db.get(
            `SELECT activityFilter FROM tracked_users WHERE channelId = ? AND anilistUserId = ?`,
            [channelId, anilistUserId]
        );
        if (dbRow && dbRow.activityFilter && dbRow.activityFilter !== trackingInfo.activityFilter) {
            console.warn(
                `⚠️ Filter drift for ${trackingInfo.anilistUsername} in channel ${channelId}: ` +
                `memory=${trackingInfo.activityFilter}, db=${dbRow.activityFilter}. Using DB.`
            );
            trackingInfo.activityFilter = dbRow.activityFilter;
        }
    } catch (e) {
        // Best-effort — if the SELECT fails, fall back to memory.
        console.warn(`Filter re-read failed for ${trackingInfo.anilistUsername}: ${e.message}`);
    }

    const { anilistUsername, lastActivityId, userAvatar, userColor, titleLanguage, profileLastUpdated, activityFilter } = trackingInfo;
    const filter = activityFilter || "both";
    const now = Date.now();
    const userKey = `${channelId}:${anilistUserId}`;
    const isFirstPoll = !firstPollComplete.has(userKey);

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
                Page(page: 1, perPage: 20) { 
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
                Page(page: 1, perPage: 20) { 
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

        const data = await aniListFetch(combinedQuery, variables);

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

            // No checkpoint here — synchronous=NORMAL fsyncs at commit, and the
            // 30-minute periodic checkpoint folds WAL into the main DB file.
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

            // First-poll backlog guard. After a redeploy, any pending backlog
            // is summarised down to the most recent activity so the channel
            // doesn't get flooded by downtime catch-up. Re-armed every restart.
            if (isFirstPoll && newActivities.length > 1) {
                const skipped = newActivities.length - 1;
                console.log(
                    `🔧 Startup catch-up for ${anilistUsername}: posting most recent only, ` +
                    `skipping ${skipped} backlog activit${skipped === 1 ? 'y' : 'ies'}.`,
                );
                newActivities = [newActivities[0]];
            }

            if (newActivities.length > 0) {
                // 15 ka cap so a long absence can't dump 50 posts at once.
                const activitiesToShow = newActivities.slice(0, 15);
                const skippedCount = newActivities.length - activitiesToShow.length;

                console.log(
                    `${newActivities.length} new activity/activities for ${anilistUsername} (filter: ${filter}, channel: ${channelId})` +
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
                                iconURL: currentAvatar ?? undefined,
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

        // Successful round-trip — guard is now consumed for this user.
        // (A throw skips this line, so failed first polls re-arm themselves.)
        firstPollComplete.add(userKey);
    } catch (error) {
        if (error.name === "RateLimitError") {
            // Already logged at source; don't duplicate. Guard stays armed.
            return;
        }
        console.error(`Error fetching activity for ${anilistUsername}:`, error);
    }
}

// =========================================================================
// Ready handler — initial check + intervals
// =========================================================================

client.on(Events.ClientReady, () => {
    if (!client.user) return; // unreachable in practice, but narrows client.user for TS
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
        // No tracked users → no work, no log line, no wakeup cost.
        if (Object.keys(trackedUsers).length === 0) return;

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

    // One immediate backup so a fresh deploy snapshots within seconds, then
    // weekly thereafter. Single rotating file (overwritten in place) — coarse
    // safety net against accidental deletion, not granular point-in-time.
    backupDatabase();
    setInterval(backupDatabase, 7 * 24 * 60 * 60 * 1000); // 7 days
});

// =========================================================================
// Slash command dispatcher
// =========================================================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;

    try {
        await interaction.deferReply({
            flags: cmd.ephemeral ? [MessageFlags.Ephemeral] : undefined,
        });
    } catch (error) {
        console.error(
            "Fatal: Failed to defer reply. The interaction is likely invalid.",
            error,
        );
        return;
    }

    // Bag of runtime references for command handlers.
    const ctx = {
        client,
        db,
        trackedUsers,
        webhookCache,
        permissionsCache,
        checkAniListActivity,
        commands,
    };

    try {
        await cmd.execute(interaction, ctx);
    } catch (error) {
        // RateLimitError is expected and already logged at source — give the
        // user a clear "try again in Xs" instead of a generic failure.
        if (error.name === "RateLimitError") {
            const sec = Math.ceil(error.retryAfterMs / 1000);
            try {
                await interaction.editReply(
                    `AniList is temporarily rate-limiting us. Try again in ~${sec}s.`,
                );
            } catch (e) {
                console.error("Failed to send rate-limit reply:", e.message);
            }
            return;
        }
        console.error(
            `An error occurred while executing the /${interaction.commandName} command:`,
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
 * Resolve the on-disk SQLite path. Replit deployments persist
 * `$REPL_HOME/bot.db` across redeploys; locally we use `./bot.db`.
 */
function resolveDbPath() {
    return process.env.REPL_HOME
        ? path.join(process.env.REPL_HOME, 'bot.db')
        : './bot.db';
}

/**
 * Snapshot bot.db to bot.db.backup. Best-effort — failures log but never
 * propagate. Coarse weekly insurance against accidental deletion or
 * corruption; not a substitute for proper external backups.
 */
function backupDatabase() {
    const dbPath = resolveDbPath();
    try {
        fs.copyFileSync(dbPath, dbPath + '.backup');
        console.log("✓ Database backup written.");
    } catch (e) {
        console.error("Database backup failed:", e.message);
    }
}

/**
 * Open the SQLite database (WAL mode), apply idempotent migrations,
 * hydrate the in-memory `trackedUsers` cache, and log into Discord.
 * Uses $REPL_HOME/bot.db when running on Replit, ./bot.db locally.
 */
async function startBot() {
    try {
        const dbPath = resolveDbPath();

        console.log(`Database path: ${dbPath}`);
        db = await open({ filename: dbPath, driver: sqlite3.Database });
        console.log("Connected to the SQLite database.");

        // WAL mode = better concurrent reads + crash resistance.
        await db.exec("PRAGMA journal_mode = WAL;");
        // synchronous=NORMAL fsyncs at COMMIT (default with WAL, but stated
        // explicitly so a future PRAGMA tweak doesn't quietly weaken durability).
        await db.exec("PRAGMA synchronous = NORMAL;");
        // 5 second wait on lock contention (e.g. someone manually opens bot.db
        // in `sqlite3` shell while the bot is live) before SQLITE_BUSY fires.
        await db.exec("PRAGMA busy_timeout = 5000;");

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
            console.log(`  [${index + 1}] User: ${row.anilistUsername} (ID: ${row.anilistUserId}), Filter: ${row.activityFilter ?? 'NULL'}, LastActivityId: ${row.lastActivityId}, Channel: ${row.channelId}`);
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
 * Wired to all termination signals (SIGINT/SIGTERM/SIGQUIT/SIGHUP) below,
 * so a Replit redeploy gets a clean shutdown instead of bypassing the WAL
 * checkpoint and db.close().
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

// All termination signals route through gracefulShutdown so a Replit redeploy
// (which sends SIGTERM) gets a proper WAL checkpoint + db.close() instead of
// just unlinking the lock and exiting with un-checkpointed writes.
['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGHUP'].forEach(signal => {
    process.on(signal, () => gracefulShutdown(signal));
});

// bot shuru karte hain
startBot();
