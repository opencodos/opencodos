# Telegram Agent

A standalone two-way Telegram agent that syncs messages to Obsidian and provides an interactive Claude-powered chat interface.

## Features

- **QR Login**: Simple terminal-based Telegram authentication
- **Folder Support**: Browse conversations by your Telegram folders
- **Interactive Selector**: TUI to pick which conversations to sync
- **Sync Mode**: Automatically fetch new Telegram messages and save to Obsidian
- **Unread-Only Sync**: Optionally sync only conversations with unread messages
- **Type Filters**: Include/exclude DMs, groups, channels
- **Mark Unread**: Preserve unread state in Telegram app after syncing
- **CRM Integration**: Automatic contact matching during ingestion
- **Chat Mode**: Interactive CLI to send messages and query message history via Claude

## Setup

### 1. Create Virtual Environment

```bash
cd ingestion/Telegram-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Get Telegram API Credentials

1. Go to https://my.telegram.org
2. Log in with your phone number
3. Go to "API development tools"
4. Create a new application
5. Copy the `api_id` and `api_hash`

### 3. Configure

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml` with your:
- Telegram API credentials (or set `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` env vars)
- Anthropic API key (or set `ANTHROPIC_API_KEY` env var)

### 4. Login to Telegram

```bash
python agent.py login
```

Scan the QR code with your Telegram app (Settings > Devices > Link Desktop Device).

### 5. Select Conversations (Optional)

```bash
python agent.py select
```

Use the interactive TUI to pick which conversations to sync. This is only needed if using pre-selected mode (not unread-only mode).

## Usage

### Sync Messages

```bash
python agent.py sync
```

### Interactive Chat

```bash
python agent.py chat
```

Example commands in chat mode:
- "Send 'Hello!' to Family Chat"
- "Summarize recent messages from Work Group"
- "Search for messages about the meeting"

### List Selected Conversations

```bash
python agent.py list
```

## Configuration

### Sync Options

```yaml
sync:
  initial_lookback_days: 7      # How far back to sync on first run

  # Unread-only mode (recommended)
  sync_unread_only: true        # Only sync conversations with unread messages

  # Type filters (only apply when sync_unread_only: true)
  include_dms: true             # Include direct messages
  include_groups: true          # Include group chats
  include_channels: false       # Include channels
  include_muted: false          # Include muted conversations
  include_archived: false       # Include archived conversations

  # Post-sync behavior
  mark_unread_after_sync: true  # Keep messages unread in Telegram app
```

### Sync Modes

| Mode | Description | Config |
|------|-------------|--------|
| **Pre-selected** | Sync specific conversations chosen via TUI | `sync_unread_only: false` |
| **Unread-only** | Auto-sync all unread conversations matching filters | `sync_unread_only: true` |

### Discovery Options

```yaml
discovery:
  enabled: true
  auto_add_groups: true      # Auto-add new groups to whitelist
  auto_add_dms: true         # Auto-add new DMs to whitelist
  auto_add_channels: false   # Auto-add new channels to whitelist
  notify_on_new: true        # Log when new conversations discovered
```

## CRM Integration

When syncing, the agent automatically matches conversations to your CRM contacts:

1. Loads `contacts.yaml` from CRM folder
2. Fuzzy-matches conversation name → contact
3. Writes match data to markdown frontmatter:

```yaml
---
telegram_id: "123456789"
type: private
last_synced: 2026-01-27T10:30:00Z
matched_contact_id: c_042
matched_contact_name: John Doe
match_confidence: 0.85
---
```

Match confidence thresholds:
- `1.0` — Exact telegram_id match
- `0.9` — Name contains match
- `0.85` — Word overlap match
- `0.6+` — Fuzzy match (written to frontmatter)
- `<0.6` — No match

## UI Control

Filter settings can be controlled via the web UI:

1. Start backend: `cd dev/gateway-backend && python server.py`
2. Start frontend: `cd dev/frontend && npm run dev`
3. Go to **Schedules** page
4. Find **Telegram** card → toggle sync settings

API endpoints:
- `GET /api/setup/schedules/telegram/filters` — Get current settings
- `POST /api/setup/schedules/telegram/filters` — Update settings

## Automated Sync (Cron)

Add to crontab (`crontab -e`):

```
*/5 * * * * cd ~/Projects/codos/ingestion/Telegram-agent && .venv/bin/python agent.py sync >> logs/sync.log 2>&1
```

Or use the **Schedules** page in the UI to configure LaunchAgent-based scheduling.

## File Structure

```
Telegram-agent/
├── config.yaml           # Your configuration
├── session.string        # Telegram session (auto-generated)
├── checkpoint.json       # Sync state (auto-generated)
├── agent.py              # CLI entry point
└── src/
    ├── config.py         # Configuration loader
    ├── telegram_client.py # Telegram API wrapper
    ├── selector.py       # TUI conversation selector
    ├── obsidian.py       # Markdown file writer
    ├── sync.py           # Sync logic with CRM integration
    └── claude.py         # Claude integration
```

## Output

Messages are synced to:
```
Vault/1 - Inbox (Last 7 days)/Telegram/
├── DMs/
│   ├── John Doe.md
│   └── Jane Smith.md
├── Groups/
│   ├── Family Chat.md
│   └── Work Group.md
└── Channels/
    └── News Channel.md
```

Each file contains:
- YAML frontmatter with metadata + CRM match
- Messages grouped by date, newest first

## Security

- `session.string` contains your Telegram auth - keep it secret
- Add `session.string` and `config.yaml` to `.gitignore`
- Use environment variables for API keys in production

## License

MIT
