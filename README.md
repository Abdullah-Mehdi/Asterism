# Asterism - AniList Discord Bot

A Discord bot that tracks AniList user activity and posts updates to Discord channels in real-time. Get notified when users update their anime/manga lists, complete episodes, or change their watching status. Now featuring slash commands, persistent data storage, and robust error handling!

## Features

- 🔍 **Real-time Tracking**: Monitors AniList user activity every 5 minutes
- 📊 **Rich Embeds**: Beautiful Discord embeds with anime cover images and metadata
- 🎯 **Channel-specific**: Track different users in different Discord channels
- ⚡ **Slash Commands**: Modern Discord slash command interface
- 🔗 **Direct Links**: Clickable links to AniList profiles and media pages
- 💾 **Persistent Storage**: SQLite database ensures data survives bot restarts
- 🛡️ **Error Resilience**: Advanced error handling prevents crashes
- 👥 **Multi-user Support**: Track multiple users per channel with easy management
- 🔒 **Smart Privacy**: Ephemeral replies for private informationniList Discord Bot

## Commands

| Command | Description | Usage | Visibility |
|---------|-------------|-------|------------|
| `/track <username>` | Start tracking an AniList user in the current channel | `/track YourUsername` | Public |
| `/untrack <username>` | Stop tracking a specific user in the current channel | `/untrack YourUsername` | Private |
| `/list` | Show all AniList users currently being tracked in this channel | `/list` | Private |
| `/help` | Display available commands with detailed descriptions | `/help` | Private |

**🔒 Privacy Notes:**
- **Public commands** are visible to everyone in the channel
- **Private commands** use ephemeral replies (only you can see the response)
- This keeps channel clean and protects sensitive information

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

4. **Set up configuration**
   Create a `config.json` file in the root directory:
   ```json
   {
     "token": "your_discord_bot_token_here"
   }
   ```
   
   **Alternative**: You can still use a `.env` file if you prefer:
   ```env
   DISCORD_TOKEN=your_discord_bot_token_here
   ```
   (You'll need to modify the code to use `process.env.DISCORD_TOKEN` instead)

5. **Register slash commands**
   Before first use, you need to register the slash commands with Discord:
   ```bash
   # You'll need to create a separate script or use Discord Developer Portal
   # to register /track, /untrack, /list, and /help commands
   ```

6. **Invite the bot to your server**
   - In the Discord Developer Portal, go to OAuth2 > URL Generator
   - Select "bot" and "applications.commands" scopes
   - Select the following permissions:
     - Send Messages
     - Embed Links
     - Use Slash Commands
   - Use the generated URL to invite the bot

7. **Run the bot**
   ```bash
   npm start
   # or
   node index.js
   ```

## Hosting on Replit

The bot can be hosted on Replit, though the current version doesn't include the web server:

1. **Import to Replit**
   - Create a new Repl on [Replit](https://replit.com)
   - Import from GitHub or upload your files
   - Replit will automatically detect it's a Node.js project

2. **Set Configuration**
   - Create a `config.json` file with your bot token
   - Or use Replit's "Secrets" tab to store the token securely

3. **Register Slash Commands**
   - You'll need to register the slash commands through Discord Developer Portal
   - Or create a deployment script (not included in current version)

4. **Run**
   - Click the "Run" button in Replit
   - The bot will start and the database will be automatically created

## Bot Permissions

The bot requires the following Discord permissions:
- **Send Messages**: To post activity updates
- **Embed Links**: To send rich embed messages
- **Use Slash Commands**: To respond to slash command interactions

**Important**: The bot uses **Guild-only intents** for better performance and security.

## How It Works

1. **Database Initialization**: On startup, the bot:
   - Creates a SQLite database (`bot.db`) if it doesn't exist
   - Loads all previously tracked users into memory for fast access
   - Sets up the tracking table structure

2. **Slash Command Registration**: Commands are registered with Discord and appear in the slash command menu

3. **User Registration**: When you use `/track <username>`, the bot:
   - Queries AniList's GraphQL API to find the user and get their ID
   - Stores the user's data in both the SQLite database and in-memory cache
   - Associates them with the specific Discord channel
   - Prevents duplicate tracking of the same user in the same channel
   - Responds publicly so everyone knows tracking started

4. **Activity Monitoring**: Every 5 minutes, the bot:
   - Loops through all tracked users across all channels
   - Fetches the latest activity for each user from AniList
   - Compares it with the last known activity ID stored in the database
   - Posts new activities as rich Discord embeds

5. **Data Management**: The bot provides commands to:
   - List all tracked users in a channel (`/list`) - private response
   - Remove specific users from tracking (`/untrack <username>`) - private response
   - View help and command information (`/help`) - private response

6. **Error Handling**: Advanced error handling ensures:
   - Promise rejections don't crash the bot
   - Failed interactions are handled gracefully
   - Database errors are logged but don't stop operation
   - Network issues with AniList API are handled properly

7. **Activity Updates**: When new activity is detected, the bot:
   - Posts a rich embed with the user's profile link
   - Shows activity description (e.g., "Watched episode 5 of Attack on Titan")
   - Includes anime/manga cover image as thumbnail
   - Provides direct links to the media page on AniList
   - Updates the database with the new activity ID for future comparisons

## Example Output

### Slash Command Autocomplete
Discord will show available slash commands when you type `/`:
```
/track - Start tracking an AniList user
/untrack - Stop tracking a specific user  
/list - Show tracked users (only you see this)
/help - Show command help (only you see this)
```

### List Command (Private Response)
When you use `/list`, only you see:
```
🎯 AniList Users Tracked in this Channel
• YourUsername
• FriendUsername  
• AnotherUser
```

### Activity Updates (Public)
When a user updates their list, everyone sees:
```
👤 YourUsername's Activity
📺 Watched episode 12 of Attack on Titan: Final Season
🖼️ [Anime cover image thumbnail]
🔗 Clickable links to user profile and anime page
⏰ Timestamp: 2 minutes ago
From AniList
```

### Help Command (Private Response)
The `/help` command shows a detailed embed with:
- All available commands with proper slash command formatting
- Usage examples
- Helpful descriptions

## Project Structure

```
Asterism/
├── index.js          # Main bot file with slash commands and database logic
├── package.json      # Dependencies and project metadata  
├── config.json       # Bot token configuration (create this)
├── README.md         # This file
├── bot.db           # SQLite database (auto-generated)
└── .env             # Alternative config method (optional)
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
- **Manual Slash Command Registration**: Commands need to be registered manually before first use
- **No Auto-hosting**: Removed built-in web server (add back if needed for hosting platforms)

## Recent Updates (v3.0)

### ✅ **Major Changes**
- **Slash Commands**: Migrated from prefix commands (`!anilist`) to modern slash commands (`/track`)
- **Smart Privacy**: Commands like `/list`, `/help`, `/untrack` use ephemeral replies (private)
- **Advanced Error Handling**: Unhandled promise rejection protection prevents crashes
- **Improved Configuration**: Uses `config.json` instead of `.env` file
- **Modern Discord.js**: Updated to use latest Discord.js features and best practices

### 🔧 **Technical Improvements**
- Guild-only intents for better performance
- Proper slash command deferral and response handling
- Robust error recovery with fallback messages
- Memory-efficient database operations with async/await
- Better separation of public vs private command responses

### 🚨 **Breaking Changes from v2.0**
- **Commands changed**: `!anilist track` → `/track`
- **Configuration**: Now requires `config.json` file
- **Permissions**: Bot needs "Use Slash Commands" permission
- **Setup**: Slash commands must be registered before use

## Future Enhancements

- 🤖 **Auto Command Registration**: Automatic slash command deployment script
- ⚙️ **Configurable Intervals**: Per-channel activity check intervals
- 📱 **Additional Activity Types**: Forum posts, reviews, favorites tracking
- 🎨 **Customizable Themes**: User-selectable embed colors and styles
- 📊 **Analytics Dashboard**: Activity statistics and progress tracking
- 🔔 **Smart Notifications**: Mention users for milestone achievements
- 🗂️ **User Groups**: Bulk management and organization features
- 🌍 **Internationalization**: Multi-language support
- 🌐 **Web Dashboard**: Browser-based management interface
- 📈 **Activity Graphs**: Visual progress tracking and statistics

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
