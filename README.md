# Asterism

A Discord bot that watches AniList users and re-posts their anime/manga list activity into your channels — as the user, with their avatar and profile color, not as a bland bot embed.

It runs on Node.js, stores its state in SQLite, polls AniList every ten minutes, and stays out of your way.

---

## What it actually does

You run `/track <username>` in a channel. From that moment, every ten minutes Asterism asks AniList what that user has been up to. When they finish an episode, drop a chapter, plan a watch, anything that hits their list, the bot posts a small embed in your channel — using a webhook so the post wears the user's name and AniList avatar.

If the bot has the **Manage Webhooks** permission, posts are impersonated. If not, the same embed shows up under the bot's own name. Nothing breaks; it just looks less authentic.

It also tracks per-channel preferences: filter by anime only, manga only, or both. Title language follows whatever the AniList user has set (Romaji, English, Native).

---

## Commands

| Command | Description | Visibility |
|---|---|---|
| `/track <username> [filter]` | Start tracking a user. Filter is `both` (default), `anime`, or `manga`. | Public |
| `/untrack <username>` | Stop tracking a user in the current channel. | Ephemeral |
| `/list` | Show who is being tracked in this channel. | Ephemeral |
| `/stats <username>` | Detailed stats for any AniList user (not just tracked ones). | Public |
| `/serverstats` | Aggregate stats and a leaderboard for everyone tracked in the server. | Public |
| `/help` | Lists the commands. | Ephemeral |

---

## Setup

You need Node.js 20+ and a Discord application.

1. Clone and install:
   ```bash
   git clone https://github.com/Abdullah-Mehdi/Asterism.git
   cd Asterism
   npm install
   ```

2. Create the bot in the [Discord Developer Portal](https://discord.com/developers/applications). Grab the application ID and bot token.

3. Drop a `config.json` in the project root:
   ```json
   {
     "clientId": "your_application_id",
     "token":    "your_bot_token"
   }
   ```

4. Register the slash commands once (and again any time you change `deploy-commands.js`):
   ```bash
   node deploy-commands.js
   ```
   Global commands take 5 to 15 minutes to propagate to Discord clients.

5. Invite the bot. In the Developer Portal, OAuth2 → URL Generator, pick scopes `bot` and `applications.commands`, then permissions: Send Messages, Embed Links, Use Slash Commands, and (recommended) Manage Webhooks.

6. Run it:
   ```bash
   npm start
   ```

For Replit deployment specifics, see [DEPLOYING.md](./DEPLOYING.md) — but it's not in this repo's git tree, so it's only relevant if you're me.

---

## Permissions

Required: **Send Messages**, **Embed Links**, **Use Slash Commands**.

Optional but recommended: **Manage Webhooks**. Without it, the bot can still post — it just can't impersonate. Activity embeds show up under the bot's own identity. Everything else is identical.

---

## How it runs

- **Single-instance lock**: `bot.lock` is written on startup with the current PID. If a live PID already owns the lock, the new process exits with code 1. Stale locks (dead PID) are cleared automatically. This stops Replit's Run + Deploy from spawning two bots.
- **Database**: SQLite in WAL mode at `$REPL_HOME/bot.db` (or `./bot.db` locally). Migrations are idempotent `ALTER TABLE` checks on startup.
- **Polling**: every 10 minutes, every tracked user gets one combined GraphQL call (profile data is folded into the same request once a day). On bot startup, every tracked user gets one immediate check before the interval kicks in.
- **Posting**: at most 15 activities per user per tick. Oldest first. Filtered by the per-user `anime`/`manga`/`both` preference.
- **Shutdown**: SIGINT, SIGTERM, SIGQUIT, and SIGHUP all checkpoint the WAL, close the database, and clear the lock file.

---

## Database schema

```sql
CREATE TABLE tracked_users (
    channelId          TEXT    NOT NULL,
    anilistUserId      INTEGER NOT NULL,
    anilistUsername    TEXT    NOT NULL,
    lastActivityId     INTEGER,
    userAvatar         TEXT,
    userColor          TEXT,
    titleLanguage      TEXT    DEFAULT 'ROMAJI',
    profileLastUpdated INTEGER,
    activityFilter     TEXT    DEFAULT 'both',
    PRIMARY KEY (channelId, anilistUserId)
);
```

The same AniList user can be tracked in multiple channels independently. Each channel gets its own row.

---

## Project layout

```
Asterism/
├── index.js              Main bot: lock, DB, commands, polling loop
├── deploy-commands.js    One-shot slash command registration
├── package.json
├── config.json           Not in git — you create it
├── bot.db                SQLite database, auto-created
├── bot.lock              PID lock, auto-managed
├── README.md
├── TERMS.md
└── PRIVACY.md
```

---

## Troubleshooting

**Slash commands aren't showing up.** Wait 15 minutes. If still nothing, re-run `node deploy-commands.js` and confirm `clientId` in `config.json` matches the application the bot is actually logged in as.

**`/track` says "Could not find user".** The AniList API returned no result. Check spelling on https://anilist.co.

**Posts stopped appearing.** Check the logs for the per-tick `Checking for new AniList activity...` line. If absent, the process is dead — restart. If present but no posts, the bot likely lost Manage Webhooks in that channel; check for `⚠️ Missing MANAGE_WEBHOOKS permission` lines.

**Two bots are posting.** Two processes are running. On Replit, that means Run and Deploy are both live — stop Run. Locally, kill stray `node` processes.

**Database "lost" all my tracked users after a restart.** Confirm the DB path in the logs lives under `$REPL_HOME` (not `./bot.db`). On Replit, this means deploying to **Reserved VM**, not Autoscale — Autoscale wipes the filesystem.

---

## Legal

- [Terms of Service](./TERMS.md)
- [Privacy Policy](./PRIVACY.md)
- Licensed under ISC.

This bot is not affiliated with AniList or Discord. It uses the public AniList GraphQL API and the Discord API in line with their terms.
