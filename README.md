# Asterism - AniList Discord Bot

A Discord bot that tracks AniList user activity and posts updates to Discord channels in real-time. Get notified when users update their anime/manga lists, complete episodes, or change their watching status. Features webhook-based activity posts, user statistics, profile customization, and robust data persistence!

## ✨ Features

### Core Functionality
- 🎭 **Webhook-Based Posts**: Activity updates appear as if posted by the actual user (with their avatar and username)
- 📊 **Rich Embeds**: Beautiful Discord embeds with anime cover images and metadata
- 🔍 **Batch Activity Tracking**: Shows ALL activities between checks (up to 15 at once)
- ⏱️ **10-Minute Intervals**: Efficient monitoring with reduced API load
- 🎨 **Profile Customization**: Respects user's AniList profile colors and title language preferences
- 💾 **Persistent Storage**: SQLite with WAL mode ensures data survives crashes and restarts

### User Experience
- ⚡ **Slash Commands**: Modern Discord slash command interface
- 🌐 **Title Language Support**: Shows titles in user's preferred language (Romaji/English/Native)
- 📈 **Statistics Commands**: View detailed stats for individual users or entire server
- 🎯 **Channel-Specific**: Track different users in different Discord channels
- 🔒 **Smart Privacy**: Ephemeral replies for management commands
- 🛡️ **Error Resilience**: Advanced error handling prevents crashes

### Technical Excellence
- 🔄 **Profile Caching**: 24-hour cache reduces API calls by 98%
- 💪 **Graceful Shutdown**: Proper database closure on restart
- 🔐 **Permission Handling**: Automatic fallback when webhook permissions unavailable
- 📝 **Database Verification**: All writes are verified and checkpointed
- 🚀 **Immediate Startup Check**: No 10-minute wait after bot restarts

## 📋 Commands

| Command | Description | Visibility |
|---------|-------------|------------|
| `/track <username>` | Start tracking an AniList user in the current channel | Public |
| `/untrack <username>` | Stop tracking a specific user in the current channel | Private |
| `/list` | Show all AniList users currently being tracked in this channel | Private |
| `/stats <username>` | Display detailed statistics for any AniList user | Public |
| `/serverstats` | Show combined statistics for all tracked users in the server | Public |
| `/help` | Display available commands with detailed descriptions | Private |

**🔒 Privacy Notes:**
- **Public commands**: Visible to everyone in the channel
- **Private commands**: Ephemeral replies (only you can see)
- Activity updates use webhooks when available for authentic appearance

## 🎨 What Makes It Special

### Webhook-Based Activity Posts
Activity updates appear with the **user's actual AniList avatar and username**, making it look like they posted it themselves:

```
👤 BlankIts [with their AniList avatar]
├─ BlankIts's Activity [clickable profile link]
├─ read chapter 26 - Smoking Behind the Supermarket with You
├─ [Manga cover image]
└─ 🤖 Asterism • From AniList • 5:14 AM
```

### Profile Customization
- **Colors**: Uses each user's AniList profile color for embeds
- **Avatars**: Shows user's AniList profile picture
- **Title Language**: Respects user's preference (Romaji/English/Native)
- **Automatic Updates**: Profile data cached for 24 hours, then refreshed

### Statistics Commands

**`/stats <username>`** shows:
- Anime statistics (count, episodes watched, days watched, mean score)
- Manga statistics (count, chapters read, volumes read, mean score)
- Top 3 favorite anime, manga, and favorite character
- User's banner image (if they have one)

**`/serverstats`** shows:
- Combined stats for all tracked users in the server
- Total anime/manga watched across everyone
- Total episodes and chapters
- Top 5 anime watchers with avatars and profile links

## 🚀 Setup

### Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Discord Developer Application
- SQLite3 (included in dependencies)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Abdullah-Mehdi/Asterism.git
   cd Asterism
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a Discord Bot**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to the "Bot" section
   - Create a bot and copy the token
   - Get your Application ID (Client ID) from the "General Information" tab

4. **Set up configuration**
   Create a `config.json` file in the root directory:
   ```json
   {
     "clientId": "your_application_id_here",
     "token": "your_discord_bot_token_here"
   }
   ```

5. **Register slash commands**
   ```bash
   node deploy-commands.js
   ```
   This registers `/track`, `/untrack`, `/list`, `/stats`, `/serverstats`, and `/help` commands globally.

6. **Invite the bot to your server**
   - In the Discord Developer Portal, go to OAuth2 > URL Generator
   - Select scopes: `bot` and `applications.commands`
   - Select permissions:
     - ✅ Send Messages
     - ✅ Embed Links
     - ✅ Manage Webhooks (for webhook-based posts)
     - ✅ Use Slash Commands
   - Use the generated URL to invite the bot

7. **Run the bot**
   ```bash
   node index.js
   ```

## 🔧 Bot Permissions

### Required Permissions
- **Send Messages**: To post activity updates
- **Embed Links**: To send rich embed messages
- **Use Slash Commands**: To respond to slash commands

### Optional (Recommended)
- **Manage Webhooks**: For webhook-based activity posts (with user avatars)
  - If not granted, bot automatically falls back to regular messages
  - Activity updates still work, just appear from the bot instead

## 📊 How It Works

### Database & Performance
1. **Startup**: Loads all tracked users from SQLite database into memory
2. **WAL Mode**: Uses Write-Ahead Logging for crash resistance
3. **Periodic Checkpoints**: Database synced every 30 minutes
4. **Graceful Shutdown**: Proper database closure on SIGTERM/SIGINT signals
5. **Profile Caching**: User profiles cached for 24 hours (reduces API calls by 98%)

### Activity Monitoring
1. **Immediate Check**: Runs check immediately on startup
2. **10-Minute Interval**: Checks all tracked users every 10 minutes
3. **Batch Detection**: Finds ALL new activities since last check (up to 15 shown)
4. **Chronological Order**: Posts activities oldest-to-newest
5. **Smart Updates**: Only posts new activities, never duplicates

### Webhook System
1. **Creation**: Creates one webhook per channel (cached)
2. **Verification**: Validates webhook exists before each use
3. **Fallback**: Automatically uses regular messages if webhooks fail
4. **Recovery**: Recreates broken webhooks automatically
5. **Permissions**: Gracefully handles missing webhook permissions

## 🗄️ Database Schema

```sql
CREATE TABLE tracked_users (
    channelId TEXT NOT NULL,           -- Discord channel ID
    anilistUserId INTEGER NOT NULL,    -- AniList user ID
    anilistUsername TEXT NOT NULL,     -- AniList username
    lastActivityId INTEGER,            -- Last tracked activity ID
    userAvatar TEXT,                   -- Cached AniList avatar URL
    userColor TEXT,                    -- Cached profile color
    titleLanguage TEXT,                -- Title language preference
    profileLastUpdated INTEGER,        -- Cache timestamp
    PRIMARY KEY (channelId, anilistUserId)
);
```

## 📦 Project Structure

```
Asterism/
├── index.js              # Main bot with slash commands, webhooks, and database
├── deploy-commands.js    # Slash command registration script
├── package.json          # Dependencies and project metadata
├── config.json           # Bot configuration (you create this)
├── bot.db               # SQLite database (auto-generated)
├── README.md            # This file
├── TERMS.md             # Terms of Service
├── PRIVACY.md           # Privacy Policy
└── .gitignore           # Git ignore rules
```

## 🔌 API Integration

### AniList GraphQL API
- **User Profiles**: Avatars, colors, title language preferences
- **Activity Feed**: Latest anime/manga list updates
- **Statistics**: Anime/manga counts, episodes, scores
- **Media Information**: Titles, cover images, URLs
- **Rate Limit Friendly**: 98% reduction in API calls via caching

### Discord API
- **Slash Commands**: Modern command interface
- **Webhooks**: User-impersonation for activity posts
- **Embeds**: Rich message formatting
- **Ephemeral Messages**: Private command responses

## 📈 Performance

### API Call Optimization
- **Before caching**: ~2 calls per user per check (720 calls/day for 6 users)
- **After caching**: ~0.04 calls per user per check (14 calls/day for 6 users)
- **Reduction**: 98% fewer API calls

### Activity Handling
- **Check Interval**: 10 minutes (reduced from 5 minutes)
- **Batch Limit**: Up to 15 activities shown per check
- **Concurrent**: All tracked users checked in parallel

## 🛠️ Configuration Options

### Check Interval
Change line 363 in `index.js`:
```javascript
}, 600000); // 10 minutes (600000ms)
```

### Activity Display Limit
Change line 245 in `index.js`:
```javascript
const activitiesToShow = newActivities.slice(0, 15); // Show 15 max
```

### Profile Cache Duration
Change line 26 in `index.js`:
```javascript
const PROFILE_CACHE_DURATION = 86400000; // 24 hours
```

## 🐛 Troubleshooting

### Double Posts
- **Cause**: Multiple bot instances running
- **Fix**: Run `pkill -9 node` on Replit, then restart

### Missing Webhook Posts
- **Cause**: Bot lacks "Manage Webhooks" permission
- **Behavior**: Automatically falls back to regular messages
- **Fix**: Re-invite bot with updated permissions

### Database Not Persisting
- **Cause**: WAL file not checkpointed
- **Fix**: Bot now auto-checkpoints every 30 minutes + on shutdown

### Commands Not Appearing
- **Cause**: Commands not registered with Discord
- **Fix**: Run `node deploy-commands.js`
- **Wait**: Global commands take 5-15 minutes to propagate

## 📜 Legal

- **Terms of Service**: [TERMS.md](./TERMS.md)
- **Privacy Policy**: [PRIVACY.md](./PRIVACY.md)

## 🚀 Recent Updates (v4.0)

### ✨ New Features
- **Webhook-based activity posts** with user avatars and usernames
- **Profile customization** (colors, avatars, title languages)
- **`/stats` command** for individual user statistics
- **`/serverstats` command** for server-wide analytics
- **Batch activity tracking** (shows all activities between checks)
- **Profile caching** (24-hour cache, 98% API reduction)

### 🔧 Technical Improvements
- **10-minute check interval** (reduced load)
- **WAL mode** for database crash resistance
- **Periodic checkpointing** for data persistence
- **Graceful shutdown** handling
- **Immediate startup check** (no waiting period)
- **Activity cap** at 15 to prevent spam
- **Webhook fallback** system with auto-recovery

### 🛡️ Stability Enhancements
- **Double-post prevention** with edge case handling
- **Database write verification** on all operations
- **Better error messages** with detailed logging
- **Permission graceful degradation**
- **Network error resilience**

## 🔮 Potential Future Features

- Activity filtering (anime-only, manga-only, by status)
- Weekly digest mode
- User comparison features
- Seasonal tracking
- Custom activity templates
- Role-based access control
- Multi-server dashboard
- Rate limit dashboard

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Abdullah-Mehdi/Asterism/issues)
- **AniList API**: [Documentation](https://anilist.gitbook.io/anilist-apiv2-docs/)
- **Discord.js**: [Documentation](https://discord.js.org/)

## ⚖️ License

This project is licensed under the ISC License - see the LICENSE file for details.

## 📝 Disclaimer

This bot is not affiliated with AniList or Discord. It uses the public AniList API and Discord API in accordance with their respective terms of service.
