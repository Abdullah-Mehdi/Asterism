# Asterism - AniList Discord Bot

A Discord bot that tracks AniList user activity and posts updates to Discord channels in real-time. Get notified when users update their anime/manga lists, complete episodes, or change their watching status. 

## Features

- 🔍 **Real-time Tracking**: Monitors AniList user activity every 5 minutes
- 📊 **Rich Embeds**: Beautiful Discord embeds with anime cover images and metadata
- 🎯 **Channel-specific**: Track different users in different Discord channels
- ⚡ **Instant Setup**: Simple commands to start/stop tracking users
- 🔗 **Direct Links**: Clickable links to AniList profiles and media pages
- 💾 **Persistent Storage**: SQLite database ensures data survives bot restarts
- 🌐 **24/7 Hosting**: Built-in web server for reliable Replit hosting
- 👥 **Multi-user Support**: Track multiple users per channel with easy management

## Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `!anilist track <username>` | Start tracking an AniList user in the current channel | `!anilist track YourUsername` |
| `!anilist untrack <username>` | Stop tracking a specific user in the current channel | `!anilist untrack YourUsername` |
| `!anilist list` | Show all AniList users currently being tracked in this channel | `!anilist list` |
| `!anilist help` | Display available commands with detailed descriptions | `!anilist help` |

**Note**: `register`/`unregister` are aliases for `track`/`untrack` commands.

## Setup

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

4. **Set up environment variables**
   Create a `.env` file in the root directory:
   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   ```

5. **Invite the bot to your server**
   - In the Discord Developer Portal, go to OAuth2 > URL Generator
   - Select "bot" scope
   - Select the following permissions:
     - Send Messages
     - Embed Links
     - Read Message History
   - Use the generated URL to invite the bot

6. **Run the bot**
   ```bash
   node index.js
   ```

## Hosting on Replit

The bot includes built-in support for 24/7 hosting on Replit:

1. **Import to Replit**
   - Create a new Repl on [Replit](https://replit.com)
   - Import from GitHub or upload your files
   - Replit will automatically detect it's a Node.js project

2. **Set Environment Variables**
   - In your Repl, go to the "Secrets" tab (lock icon)
   - Add your `DISCORD_TOKEN` as a secret

3. **Enable Always On**
   - The bot includes a web server that responds on port 8080
   - This keeps the bot alive on Replit's free tier
   - Consider upgrading to Replit's paid plan for true 24/7 hosting

4. **Run**
   - Click the "Run" button in Replit
   - The bot will start and the database will be automatically created

## Bot Permissions

The bot requires the following Discord permissions:
- **Send Messages**: To post activity updates
- **Embed Links**: To send rich embed messages
- **Read Message History**: To read commands

## How It Works

1. **Database Initialization**: On startup, the bot:
   - Creates a SQLite database (`bot.db`) if it doesn't exist
   - Loads all previously tracked users into memory for fast access
   - Sets up the tracking table structure

2. **User Registration**: When you use `!anilist track <username>`, the bot:
   - Queries AniList's GraphQL API to find the user and get their ID
   - Stores the user's data in both the SQLite database and in-memory cache
   - Associates them with the specific Discord channel
   - Prevents duplicate tracking of the same user in the same channel

3. **Activity Monitoring**: Every 5 minutes, the bot:
   - Loops through all tracked users across all channels
   - Fetches the latest activity for each user from AniList
   - Compares it with the last known activity ID stored in the database
   - Posts new activities as rich Discord embeds

4. **Data Management**: The bot provides commands to:
   - List all tracked users in a channel (`!anilist list`)
   - Remove specific users from tracking (`!anilist untrack <username>`)
   - View help and command information (`!anilist help`)

5. **Activity Updates**: When new activity is detected, the bot:
   - Posts a rich embed with the user's profile link
   - Shows activity description (e.g., "Watched episode 5 of Attack on Titan")
   - Includes anime/manga cover image as thumbnail
   - Provides direct links to the media page on AniList
   - Updates the database with the new activity ID for future comparisons

## Example Output

### List Command
When you use `!anilist list`, the bot shows:
```
🎯 AniList Users Tracked in this Channel
• YourUsername
• FriendUsername
• AnotherUser
```

### Activity Updates
When a user updates their list, the bot posts an embed like:
```
👤 YourUsername's Activity
📺 Watched episode 12 of Attack on Titan: Final Season
🖼️ [Anime cover image thumbnail]
🔗 Clickable links to user profile and anime page
⏰ Timestamp: 2 minutes ago
From AniList
```

### Help Command
The `!anilist help` command displays a detailed embed with:
- All available commands
- Usage examples
- Helpful tips and formatting

## Project Structure

```
Asterism/
├── index.js          # Main bot file with all functionality
├── package.json      # Dependencies and project metadata
├── README.md         # This file
├── bot.db           # SQLite database (auto-generated)
└── .env             # Environment variables (create this)
```

## Dependencies

- **discord.js** (^14.21.0): Discord API wrapper for Node.js
- **dotenv** (^17.2.0): Load environment variables from .env file
- **node-fetch** (^2.7.0): HTTP client for making API requests to AniList
- **sqlite3** (^5.1.7): SQLite database driver for persistent data storage

## Database Schema

The bot uses SQLite with the following table structure:

```sql
CREATE TABLE tracked_users (
    channelId TEXT NOT NULL,        -- Discord channel ID
    anilistUserId INTEGER NOT NULL, -- AniList user ID
    anilistUsername TEXT NOT NULL,  -- AniList username
    lastActivityId INTEGER,         -- Last tracked activity ID
    PRIMARY KEY (channelId, anilistUserId)
);
```

This design allows:
- Multiple users per channel
- Same user tracked in different channels
- Efficient lookups and updates
- Data persistence across bot restarts

## API Usage

The bot uses the [AniList GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/) to:
- Find users by username and get their unique AniList ID
- Fetch the latest list activities using user ID for better reliability
- Get media information (titles, cover images, URLs)
- No authentication required - uses public API endpoints

## Limitations

- **5-minute Intervals**: Activity checks happen every 5 minutes (configurable in code)
- **Single Activity**: Only tracks the most recent list activity per user
- **List Activities Only**: Currently tracks anime/manga list updates, not forum posts or reviews
- **Replit Limitations**: Free Replit hosting may have some downtime (upgrade for true 24/7)

## Recent Updates (v2.0)

### ✅ **New Features**
- **Persistent Storage**: SQLite database replaces in-memory storage
- **Multiple Users**: Track multiple users per channel
- **List Command**: View all tracked users in a channel
- **Improved Untrack**: Untrack specific users by username
- **Replit Ready**: Built-in web server for 24/7 hosting
- **Better Error Handling**: Comprehensive error messages and validation

### 🔧 **Technical Improvements**
- Database initialization on startup
- In-memory caching for performance
- Proper SQL relationships and constraints
- Duplicate tracking prevention
- Enhanced command validation

## Future Enhancements

- ⚙️ Configurable check intervals per channel
- 📱 Additional activity types (forum posts, reviews, favorites)
- 🎨 Customizable embed themes and colors
- 📊 Activity statistics and analytics dashboard
- 🔔 Mention notifications for specific activities or milestones
- 🗂️ User groups and bulk management commands
- 🌍 Multi-language support for international users
- 📈 Activity graphs and progress tracking

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:
- Open an issue on [GitHub](https://github.com/Abdullah-Mehdi/Asterism/issues)
- Check the [AniList API documentation](https://anilist.gitbook.io/anilist-apiv2-docs/)
- Review the [Discord.js documentation](https://discord.js.org/)

## Disclaimer

This bot is not affiliated with AniList. It uses the public AniList API in accordance with their terms of service.
