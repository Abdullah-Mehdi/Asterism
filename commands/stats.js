// @ts-check
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { aniListFetch } = require("../lib/anilist");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Shows detailed statistics for an AniList user.")
        .addStringOption(o =>
            o.setName("username")
                .setDescription("The AniList username to get stats for.")
                .setRequired(true)),
    ephemeral: false,
    /**
     * @param {import("discord.js").ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {
        const anilistUsername = interaction.options.getString("username", true);

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
            const data = await aniListFetch(statsQuery, { username: anilistUsername });

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
            // Re-throw RateLimitError so the dispatcher's catch surfaces the
            // friendly retry message; only swallow non-rate-limit errors here.
            if (error.name === "RateLimitError") throw error;
            console.error(`Error fetching stats for ${anilistUsername}:`, error);
            await interaction.editReply(
                `There was an error fetching statistics for **${anilistUsername}**.`
            );
        }
    },
};
