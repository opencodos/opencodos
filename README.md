# Codos

<p align="center">
  <img src="dev/Image/hero.png" alt="Codos — AI Operating System" width="100%" />
</p>

AI Operating System for digital workers. Aggregates context from your data sources (Telegram, Slack, Gmail, Calendar, Notion, Linear, Granola) and automates work via Claude Code.

## Features

- **Multi-Agent Dashboard** — Manage AI agents (Claude Code, CGO, Content Strategist, Research Analyst) from a single interface
- **Context-Aware Chat** — Agents understand your goals, CRM, calendar, and recent conversations
- **20+ Data Connectors** — Telegram, Slack, Gmail, Calendar, Notion, Linear, GitHub, Granola + Pipedream
- **CRM Pipeline** — Kanban board with deal stages, contact management, and drag-and-drop
- **50+ Skills** — Morning briefs, sales decks, research, messaging, content, engineering, and more
- **Automated Workflows** — Schedule recurring tasks via UI or YAML
- **Health Monitoring** — Real-time connector, sync, and agent status

## Installation (opencodos)

```bash
curl -fsSL https://raw.githubusercontent.com/opencodos/opencodos/main/scripts/install.sh | bash
```

To start it again:
```bash
codos start
```

### VPS Deployment (supported: Ubuntu/Debian, RHEL/CentOS)

Deploy on a remote server and access via SSH tunnel:

```bash
curl -fsSL https://raw.githubusercontent.com/opencodos/opencodos/main/scripts/install.sh | bash -s -- --remote
```

This builds the frontend, installs systemd services, and enables lingering (services survive logout).

From your local machine, open an SSH tunnel:
```bash
ssh -L 8767:localhost:8767 user@your-server-ip
```

Then open `http://localhost:8767` in your browser.

Manage services:
```bash
codos status              # Check service status
codos stop                # Stop and disable services
codos install-service     # Reinstall systemd services
codos uninstall-service   # Remove systemd services
```

## License

This project uses a dual license:

| Directory | License | Details |
|-----------|---------|---------|
| `ee/` | Commercial | Free for dev/testing; production requires a [Codos subscription](https://codos.ai) |
| Everything else | [AGPLv3](LICENSE) | Free to use, modify, and self-host. Changes must be shared if deployed as a network service |

Third-party components retain their original licenses.

See [`LICENSE`](LICENSE) and [`ee/LICENSE`](ee/LICENSE) for full terms.
