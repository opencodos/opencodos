# Composio Integrations

External service tools via MCP. Each skill documents critical tools and workflows.

## Setup

**Native MCP services** (via claude.ai Connectors — no Composio):
- Slack (Official Slack MCP)
- Notion (Official Notion MCP)
- Linear (Official Linear MCP)
- Gmail (Official Gmail MCP)
- Google Calendar (Official Google Calendar MCP)
- Google Drive (Official Google Drive MCP)

**Composio MCP servers** configured in `~/.claude.json` (user scope):
- composio-github

Config uses Composio managed OAuth. Set your Customer ID via the secrets backend: `python -m backend secrets set COMPOSIO_CUSTOMER_ID <id>`.

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

## For New Users (Multi-User Deployment)

To set up for a new user:

1. Connect native services at `claude.ai/settings/connectors` (Slack, Notion, Linear, Gmail, Calendar, Drive)
2. For Composio services (GitHub): create Composio account at https://composio.dev
3. Get API key and customer ID
4. Update `.claude/.env`:
   ```
   COMPOSIO_API_KEY=your_key
   COMPOSIO_CUSTOMER_ID=your_id
   ```
5. Update MCP URLs in `~/.claude.json` with new customer ID
6. Connect Composio services via dashboard (OAuth flows)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| MCP not responding | Restart Claude Code |
| Auth expired (native) | Re-connect via claude.ai Settings > Connectors |
| Auth expired (Composio) | Re-connect via Composio dashboard |
| Tool not found | Check MCP server is listed in `claude mcp list` or use `ToolSearch` |
| Rate limited | Wait and retry |
