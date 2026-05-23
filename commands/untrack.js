const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("untrack")
        .setDescription("Stops tracking a specific AniList user in this channel.")
        .addStringOption(o =>
            o.setName("username")
                .setDescription("The AniList username to stop tracking.")
                .setRequired(true)),
    ephemeral: true,
    async execute(interaction, ctx) {
        const { db, trackedUsers, webhookCache, permissionsCache } = ctx;
        const usernameToUntrack = interaction.options.getString("username");
        const channelId = interaction.channelId;
        const usersInChannel = trackedUsers[channelId];
        if (!usersInChannel)
            return interaction.editReply({
                content: "No users are currently being tracked in this channel.",
            });

        let userToUntrackInfo = null;
        let userIdToUntrack = null;
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
            if (Object.keys(trackedUsers[channelId]).length === 0) {
                delete trackedUsers[channelId];
                // Channel ab khaali hai — per-channel caches bhi drop kar do
                // taake long-running deploys mein stale entries jama na hon.
                delete webhookCache[channelId];
                delete permissionsCache[channelId];
            }
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
    },
};
