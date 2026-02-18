# Composio Integrations

External service tools via MCP. Each skill documents critical tools and workflows.

## Setup

MCP servers configured in `~/.claude.json` (user scope):
- composio-slack
- composio-gmail
- composio-calendar
- composio-linear
- composio-notion
- composio-github
- composio-gdrive
- composio-gdocs
- composio-gsheets

Config uses Composio managed OAuth. Customer ID: `7a389fa9-2a00-4d23-812b-4fd0b69063cc`

Minimal configs, the wrapper, and test commands live in `Dev/Ops/mcp/`.

## Available Skills

| Skill | File | Use For |
|-------|------|---------|
| Slack | `slack.md` | Team messaging, channel history |
| Gmail | `gmail.md` | Email inbox, send/reply |
| Calendar | `calendar.md` | Schedule, meetings, free slots |
| Linear | `linear.md` | Issue tracking, project management |
| Notion | `notion.md` | Pages, databases, workspace |
| GitHub | `github.md` | Repos, commits, code search |
| Google Drive | `gdrive.md` | File search, downloads |
| Google Docs | `gdocs.md` | Document read/write |
| Google Sheets | `gsheets.md` | Spreadsheet data |

## For New Users (Multi-User Deployment)

To set up for a new user:

1. Create Composio account at https://composio.dev
2. Get API key and customer ID
3. Update `.claude/.env`:
   ```
   COMPOSIO_API_KEY=your_key
   COMPOSIO_CUSTOMER_ID=your_id
   ```
4. Update MCP URLs in `~/.claude.json` with new customer ID
5. Connect services via Composio dashboard (OAuth flows)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| MCP not responding | Restart Claude Code |
| Auth expired | Re-connect via Composio dashboard |
| Tool not found | Check MCP server is listed in `claude mcp list` |
| Rate limited | Wait and retry |
