const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("list")
        .setDescription("Shows all AniList users currently being tracked in this channel."),
    ephemeral: true,
    async execute(interaction, ctx) {
        const { trackedUsers } = ctx;
        const usersInChannel = trackedUsers[interaction.channelId];
        const listEmbed = new EmbedBuilder()
            .setColor("#C3B1E1")
            .setTitle(`AniList Users Tracked in this Channel`);
        if (usersInChannel && Object.keys(usersInChannel).length > 0) {
            listEmbed.setDescription(
                Object.values(usersInChannel)
                    .map((user) => {
                        const filterEmoji = user.activityFilter === "anime" ? "📺" :
                                          user.activityFilter === "manga" ? "📖" : "📺📖";
                        const filterText = user.activityFilter === "both" ? "" :
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
    },
};
