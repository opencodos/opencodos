# Atlas Telegram Bot

Telegram interface for Claude Code. Send messages, voice notes, or images to @atlas_telegrambot and get Claude Code responses.

## Architecture

```
Telegram → bot.py → Claude Code CLI → Response → Telegram
                ↓
         Session Manager (persists conversation context)
```

## Files

| File | Purpose |
|------|---------|
| `bot.py` | Main bot - handlers for text, voice, photos, commands |
| `config.py` | Environment variables and settings |
| `session_manager.py` | Maps Telegram chats to Claude Code sessions |
| `formatter.py` | Converts Claude output to Telegram HTML |
| `sessions.json` | Persistent session storage |
| `.env` | API keys and config (not in git) |

## Key Functions (bot.py)

| Function | Line | Purpose |
|----------|------|---------|
| `run_claude()` | 92 | Executes Claude Code CLI with session context |
| `handle_message()` | 174 | Text message handler |
| `handle_voice()` | 275 | Voice transcription (AssemblyAI) → Claude |
| `handle_photo()` | 329 | Image analysis (Claude Vision) → Claude |
| `analyze_image_async()` | 241 | Claude Vision API for image description/OCR |

## Input Types

1. **Text** - Direct pass to Claude Code
2. **Voice** - Transcribed via AssemblyAI, then passed to Claude
3. **Photo** - Analyzed via Claude Vision API, description passed to Claude
   - With caption: caption becomes user context
   - Without caption: Claude acknowledges image and asks what to do

## Commands

| Command | Action |
|---------|--------|
| `/start` | Welcome message |
| `/new` or `/clear` | Reset session (fresh context) |
| `/status` | Show current session info |

## Session Management

- Each Telegram chat gets a unique Claude Code session ID
- Sessions persist across bot restarts (stored in `sessions.json`)
- Use `/new` to start fresh conversation
- Sessions use `--resume` flag to continue context

## Config (.env)

```
TELEGRAM_BOT_TOKEN=...      # From @BotFather
AUTHORIZED_USER_IDS=123,456 # Comma-separated Telegram user IDs
CLAUDE_WORKSPACE=/path/...  # Working directory for Claude Code
CLAUDE_MODEL=sonnet         # Model: sonnet, opus, haiku
ASSEMBLYAI_API_KEY=...      # For voice transcription
ANTHROPIC_API_KEY=...       # For image analysis
```

## Running

```bash
# Install deps
pip install -r requirements.txt

# Run bot
python bot.py

# Test Claude connection
python bot.py --test
```

## Process Management

The bot includes a process marker `ATLAS_TG_BOT` for safe killing:
```bash
pkill -f "ATLAS_TG_BOT"
```

## Security

- Only `AUTHORIZED_USER_IDS` can use the bot
- Runs with `--dangerously-skip-permissions` for MCP tools
- API keys stored in `.env` (gitignored)
