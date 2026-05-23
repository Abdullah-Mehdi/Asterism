const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

/**
 * Render `/track <username> [filter]` style usage from a command's option list.
 * Required options get angle brackets, optional ones get square brackets.
 */
function commandUsage(cmd) {
    const data = cmd.data.toJSON();
    const opts = (data.options || [])
        .map(o => o.required ? `<${o.name}>` : `[${o.name}]`)
        .join(" ");
    return opts ? `/${data.name} ${opts}` : `/${data.name}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Displays a list of all available commands."),
    ephemeral: true,
    async execute(interaction, ctx) {
        const helpEmbed = new EmbedBuilder()
            .setColor("#C3B1E1")
            .setTitle("AniList Bot Commands")
            .addFields(
                ctx.commands.map(c => ({
                    name: commandUsage(c),
                    value: c.data.toJSON().description,
                }))
            );
        await interaction.editReply({ embeds: [helpEmbed] });
    },
};
