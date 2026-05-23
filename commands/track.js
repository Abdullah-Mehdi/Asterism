// @ts-check
const { SlashCommandBuilder } = require("discord.js");
const { aniListFetch } = require("../lib/anilist");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("track")
        .setDescription("Starts tracking an AniList user's activity in this channel.")
        .addStringOption(o =>
            o.setName("username")
                .setDescription("The AniList username to track.")
                .setRequired(true))
        .addStringOption(o =>
            o.setName("filter")
                .setDescription("What type of activity to track (default: both)")
                .setRequired(false)
                .addChoices(
                    { name: "Both Anime and Manga", value: "both" },
                    { name: "Anime Only", value: "anime" },
                    { name: "Manga Only", value: "manga" },
                )),
    ephemeral: false,
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     * @param {import("../lib/types").CommandCtx} ctx
     */
    async execute(interaction, ctx) {
        const { db, trackedUsers, checkAniListActivity } = ctx;
        // Pass `true` as the second arg to assert "required" — narrows the
        // return type from `string | null` to `string`.
        const anilistUsername = interaction.options.getString("username", true);
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
        const data = await aniListFetch(findUserQuery, { username: anilistUsername });
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
        const filterText = activityFilter === "both" ? "all activity" :
                          activityFilter === "anime" ? "anime only" : "manga only";
        await interaction.editReply(
            `Successfully found **${anilistUsername}**. Now tracking their ${filterText} in this channel!`,
        );
        checkAniListActivity(channelId, anilistUserId);
    },
};
