# Asterism - AniList Discord Bot (starter version)

A Discord bot that tracks AniList user activity and posts updates to Discord channels in real-time. Get notified when users update their anime/manga lists, complete episodes, or change their watching status.

## Features

- 🔍 **Real-time Tracking**: Monitors AniList user activity every 5 minutes
- 📊 **Rich Embeds**: Beautiful Discord embeds with anime cover images and metadata
- 🎯 **Channel-specific**: Track different users in different Discord channels
- ⚡ **Instant Setup**: Simple commands to start/stop tracking users
- 🔗 **Direct Links**: Clickable links to AniList profiles and media pages

## Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `!anilist track <username>` | Start tracking an AniList user in the current channel | `!anilist track YourUsername` |
| `!anilist register <username>` | Alias for track command | `!anilist register YourUsername` |
| `!anilist untrack` | Stop tracking the user in the current channel | `!anilist untrack` |
| `!anilist unregister` | Alias for untrack command | `!anilist unregister` |
| `!anilist help` | Display available commands | `!anilist help` |

## Setup

### Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Discord Developer Application

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

## Bot Permissions

The bot requires the following Discord permissions:
- **Send Messages**: To post activity updates
- **Embed Links**: To send rich embed messages
- **Read Message History**: To read commands

## How It Works

1. **User Registration**: When you use `!anilist track <username>`, the bot:
   - Queries AniList's GraphQL API to find the user
   - Stores the user's AniList ID and username
   - Associates them with the Discord channel

2. **Activity Monitoring**: Every 5 minutes, the bot:
   - Fetches the latest activity for each tracked user
   - Compares it with the last known activity
   - Posts new activities as Discord embeds

3. **Activity Updates**: When new activity is detected, the bot posts:
   - User's profile link
   - Activity description (e.g., "Watched episode 5 of Attack on Titan")
   - Anime/manga cover image
   - Direct link to the media page
   - Timestamp of the activity

## Example Output

When a user updates their list, the bot posts an embed like:

```
👤 YourUsername's Activity
📺 Watched episode 12 of Attack on Titan: Final Season
🖼️ [Anime cover image]
🔗 Links to user profile and anime page
⏰ Timestamp: 2 minutes ago
```

## Project Structure

```
Asterism/
├── index.js          # Main bot file with all functionality
├── package.json      # Dependencies and project metadata
├── README.md         # This file
└── .env             # Environment variables (create this)
```

## Dependencies

- **discord.js** (^14.21.0): Discord API wrapper for Node.js
- **dotenv** (^17.2.0): Load environment variables from .env file
- **node-fetch** (^2.7.0): HTTP client for making API requests to AniList

## API Usage

The bot uses the [AniList GraphQL API](https://anilist.gitbook.io/anilist-apiv2-docs/) to:
- Find users by username
- Fetch the latest list activities
- Get media information (titles, cover images, URLs)

## Limitations

- **In-memory Storage**: Currently stores tracking data in memory (resets on restart)
- **5-minute Intervals**: Activity checks happen every 5 minutes
- **Single Activity**: Only tracks the most recent list activity per user
- **No Database**: No persistent storage (planned for future versions)

## Future Enhancements

- 🗄️ Database integration for persistent storage
- ⚙️ Configurable check intervals
- 📱 Additional activity types (forum posts, reviews)
- 🎨 Customizable embed themes
- 📊 Activity statistics and analytics
- 🔔 Mention notifications for specific activities

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
