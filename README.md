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

## Quick Start (New Users)

Prereqs:
- Python 3.10+ (via `python3`)
- Node 20.19+ or 22.12+ (see `dev/frontend/.nvmrc`)
- Claude Code CLI (`claude`)

Install Claude CLI:
```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
npm install -g @anthropic-ai/claude-code

# Add to PATH (choose your shell):
# For bash:
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bash_profile
# For zsh:
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc

# Then restart your terminal or run:
export PATH="$HOME/.npm-global/bin:$PATH"

# Verify:
claude --version
```

First time (installs deps, starts services, opens wizard):
```bash
bash scripts/bootstrap.sh --start
```

Daily use (start services only):
```bash
bash scripts/bootstrap.sh --quick
```

## Desktop App (macOS)

After bootstrap (Option A) or manual setup, you can launch the desktop app in dev mode:
```bash
npm --prefix dev/desktop run dev
```

The wizard will guide you through:
1. **Welcome** - Set your goals
2. **Claude CLI Check** - Verify `claude` is installed
3. **Repos Setup** - Configure code + vault paths
4. **API Keys** - Anthropic, Gemini (optional)
5. **Connectors** - Connect Telegram, Slack, Gmail, etc.
6. **Workspaces** - Organize your projects
7. **Import Notes** - Import existing markdown files

### Troubleshooting (common install errors)
- `pip: command not found` → use `python3 -m pip` or install Python 3.
- `SSLCertVerificationError OSStatus -26276` → run:
  `python -m pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org --trusted-host pypi.python.org -r requirements.txt`
- `Operation not permitted: /Users/.../Library/Python` → use a repo-local venv (`python3 -m venv .venv`).
- `Form data requires "python-multipart"` → ensure `python-multipart` is installed (in `requirements.txt`).
- `You are using Node.js ... requires ...` → upgrade Node or `nvm install && nvm use` in `dev/frontend`.
- `Error: listen EPERM ... ::1:5173` → use `127.0.0.1` and port `5174` (default config).
- `Claude CLI not found` → ensure `~/.npm-global/bin` is in PATH (add to `~/.bash_profile` or `~/.zshrc` and restart terminal).

### Where Config is Stored

| File | Purpose |
|------|---------|
| `~/.codos/paths.json` | Code + Vault paths (`{"vaultPath": "...", "codosPath": "..."}`) |
| `~/.codos/config.json` | User config (entity ID) |
| `dev/Ops/.env` | API keys (single source of truth) |
| `~/.claude/CLAUDE.md` | Claude Code instructions |

Context files (daily briefs, todos, CRM) are stored in the Vault, separate from code. The setup wizard configures your vault path; edit `~/.codos/paths.json` to change it.

## Structure

```
codos/
├── agents/           # Agent definitions (prompt.md per agent)
│   ├── claude/           # General-purpose coding assistant
│   ├── cgo/              # Growth & Sales
│   ├── chief-content/    # Content Strategist
│   ├── hillary/          # Chief of Staff
│   ├── karpathy/         # Senior Software Engineer
│   └── mckinsey/         # Research Analyst
├── skills/           # 50+ automation skills
│   ├── Morning Brief/    # Daily briefing generator
│   ├── Daily Todo/       # Todo list generator
│   ├── Weekly Review/    # Weekly review generator
│   ├── Research/         # Deep research with Gemini
│   ├── Schedule Meeting/ # Calendar scheduling
│   └── ...
├── src/
│   └── backend/      # Python FastAPI backend
├── ingestion/        # Data connectors
│   ├── Telegram-agent/   # Telegram sync & summaries
│   ├── lib/              # Shared ingestion utilities
│   ├── Slack/            # Slack ingestion
│   ├── Gmail/            # Gmail ingestion
│   ├── Calendar/         # Google Calendar sync
│   ├── Github/           # GitHub activity sync
│   ├── Linear/           # Linear issue sync
│   ├── Granola/          # Meeting transcripts
│   ├── Notion/           # Notion sync
│   └── Telegram/         # Telegram message ingestion
├── scripts/          # Bootstrap & setup scripts
├── ee/               # Enterprise features (commercial license)
└── dev/              # Development
    ├── frontend/           # React frontend
    ├── desktop/            # Tauri desktop app (macOS)
    └── Ops/                # Operations & configs
```

## License

This project uses a dual license:

| Directory | License | Details |
|-----------|---------|---------|
| `ee/` | Commercial | Free for dev/testing; production requires a [Codos subscription](https://codos.ai) |
| Everything else | [AGPLv3](LICENSE) | Free to use, modify, and self-host. Changes must be shared if deployed as a network service |

Third-party components retain their original licenses.

See [`LICENSE`](LICENSE) and [`ee/LICENSE`](ee/LICENSE) for full terms.
