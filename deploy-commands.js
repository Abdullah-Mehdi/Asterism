const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");
const { SlashCommandBuilder } = require("discord.js");
// Make sure your config.json has your clientId and token!
const { clientId, token } = require("./config.json");

const commands = [
    new SlashCommandBuilder()
        .setName("track")
        .setDescription(
            "Starts tracking an AniList user's activity in this channel.",
        )
        .addStringOption((option) =>
            option
                .setName("username")
                .setDescription("The AniList username to track.")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("filter")
                .setDescription("What type of activity to track (default: both)")
                .setRequired(false)
                .addChoices(
                    { name: 'Both Anime and Manga', value: 'both' },
                    { name: 'Anime Only', value: 'anime' },
                    { name: 'Manga Only', value: 'manga' }
                ),
        ),

    new SlashCommandBuilder()
        .setName("untrack")
        .setDescription(
            "Stops tracking a specific AniList user in this channel.",
        )
        .addStringOption((option) =>
            option
                .setName("username")
                .setDescription("The AniList username to stop tracking.")
                .setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName("list")
        .setDescription(
            "Shows all AniList users currently being tracked in this channel.",
        ),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Displays a list of all available commands."),

    new SlashCommandBuilder()
        .setName("stats")
        .setDescription("Shows detailed statistics for an AniList user.")
        .addStringOption((option) =>
            option
                .setName("username")
                .setDescription("The AniList username to get stats for.")
                .setRequired(true),
        ),

    new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Shows statistics for all tracked users in this server."),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
    try {
        console.log("Started refreshing application (/) GLOBAL commands.");

        // This registers the commands globally
        await rest.put(Routes.applicationCommands(clientId), {
            body: commands,
        });

        console.log("Successfully reloaded application (/) GLOBAL commands.");
    } catch (error) {
        console.error(error);
    }
})();
