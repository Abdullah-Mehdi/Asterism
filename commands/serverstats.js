// @ts-check
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { aniListFetch, getRateLimitRemainingMs } = require("../lib/anilist");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Shows statistics for all tracked users in this server."),
    ephemeral: false,
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     * @param {import("../lib/types").CommandCtx} ctx
     */
    async execute(interaction, ctx) {
        const { client, trackedUsers } = ctx;

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
                const data = await aniListFetch(userQuery, { id: parseInt(userId) });
                return data.data?.User || null;
            } catch (error) {
                if (error.name !== "RateLimitError") {
                    console.error(`Error fetching user ${userId}:`, error);
                }
                return null;
            }
        });

        try {
            const usersData = await Promise.all(userDataPromises);
            const users = usersData.filter(u => u !== null);

            if (users.length === 0) {
                // Distinguish rate-limit drought from genuine no-data.
                const waitMs = getRateLimitRemainingMs();
                if (waitMs > 0) {
                    return interaction.editReply(
                        `AniList is temporarily rate-limiting us. Try again in ~${Math.ceil(waitMs / 1000)}s.`
                    );
                }
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
                    const avatarEmoji = u.avatar?.medium ? `[🎭](${u.avatar.medium})` : "👤";
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
    },
};
