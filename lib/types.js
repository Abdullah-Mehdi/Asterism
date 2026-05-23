// @ts-check
// JSDoc-only module. No runtime exports — this file exists purely as the
// canonical anchor for project-wide @typedef declarations. Other files
// reference these types via `import("./lib/types").TypeName` in JSDoc.

/**
 * One row of the tracked_users table, after hydration into the in-memory cache.
 *
 * @typedef {Object} TrackedUser
 * @property {string}      anilistUsername
 * @property {number|null} lastActivityId
 * @property {string|null} userAvatar
 * @property {string|null} userColor
 * @property {string}      titleLanguage      ROMAJI | ENGLISH | NATIVE | ROMAJI_STYLISED
 * @property {number|null} profileLastUpdated  ms timestamp of last AniList profile fetch
 * @property {string}      activityFilter     "both" | "anime" | "manga"
 */

/**
 * Cached webhook permission state for a single channel.
 *
 * @typedef {Object} ChannelPermissionsEntry
 * @property {boolean} hasManageWebhooks
 * @property {number}  expiresAt ms timestamp when the entry should be re-checked
 */

/**
 * Bag of runtime references passed into every command's `execute` function.
 * Built freshly per interaction inside the dispatcher so commands always see
 * the live `db` and shared caches without each having to import them.
 *
 * @typedef {Object} CommandCtx
 * @property {import("discord.js").Client}                                            client
 * @property {any}                                                                    db                   sqlite Database (untyped — `sqlite` package's types aren't exported)
 * @property {Object<string, Object<string, TrackedUser>>}                            trackedUsers
 * @property {Object<string, import("discord.js").Webhook>}                           webhookCache
 * @property {Object<string, ChannelPermissionsEntry>}                                permissionsCache
 * @property {(channelId: string, anilistUserId: string|number) => Promise<void>}     checkAniListActivity
 * @property {Array<CommandModule>}                                                   commands
 */

/**
 * The shape every file in commands/ must export.
 *
 * @typedef {Object} CommandModule
 * @property {import("discord.js").SlashCommandBuilder | import("discord.js").SlashCommandOptionsOnlyBuilder | import("discord.js").SlashCommandSubcommandsOnlyBuilder} data
 * @property {boolean} [ephemeral]  whether the deferReply should be flagged ephemeral (default: false)
 * @property {(interaction: import("discord.js").ChatInputCommandInteraction, ctx: CommandCtx) => Promise<unknown>} execute
 */

module.exports = {};
