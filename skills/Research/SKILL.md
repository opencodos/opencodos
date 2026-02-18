---
name: research
description: Deep research on a topic using Gemini Deep Research. Use when needing comprehensive multi-source analysis.
---

# Deep Research Skill

> Use Gemini Deep Research for comprehensive multi-source research via browser automation.

## Trigger

`/research [topic]`

## When to Use

| Scenario | Tool |
|----------|------|
| Need 10+ sources, comprehensive analysis | Deep Research |
| Quick lookup, 2-3 sources enough | WebSearch |
| Willing to wait 5-20 minutes | Deep Research |
| Need real-time info | WebSearch |

## How It Works

1. **Primary**: Browser automation via Playwright (free with Google Workspace)
2. **Fallback**: Gemini API (if browser fails, has per-query charges)

## CODO Prompting Framework

Structure your research prompts using CODO for best results:

| Element | Description | Example |
|---------|-------------|---------|
| **C**ontext | Define persona & scenario | "You are a market analyst researching..." |
| **O**bjective | Specific questions (not open-ended) | "What are the top 5 competitors by revenue?" |
| **D**epth | Source hierarchy & constraints | "Prioritize 2024-2025 data, peer-reviewed sources" |
| **O**utput | Format & structure | "Provide a comparison table with citations" |

## Usage

### Basic
```bash
cd "skills/Research"
python3 gemini-web-research.py "AI agents market landscape 2026"
```

### With Custom Output
```bash
python3 gemini-web-research.py "topic competitors" \
  -o ~/Documents/Obsidian\ Vault/Vault/2\ -\ Projects/Research/2026-01-16-topic-competitors.md
```

### Options
| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output` | Output file path | Auto-generated in Research folder |
| `--timeout` | Max wait time (minutes) | 20 |
| `--model` | `pro` or `fast` | pro |

## First-Time Setup

### 1. Start Chrome with Remote Debugging
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-automation-profile" \
  --no-first-run &
```

### 2. Login to Google
Open `chrome://version` in that browser, sign in with your Google account.

### 3. Verify Gemini Access
Navigate to `gemini.google.com` and confirm you can access Deep Research.

### 4. Install Dependencies
```bash
cd "skills/Research"
pip3 install -r requirements.txt
```

## Output Location

Default: `Vault/2 - Projects/Research/{YYYY-MM-DD}-{topic-slug}.md`

## Concurrent Sessions

Gemini supports up to 3 parallel Deep Research sessions.

## API Fallback (Last Resort)

Only if browser automation fails:
```bash
source ~/Documents/Obsidian\ Vault/Dev/Ops/.env  # needs GOOGLE_API_KEY
python3 run-deep-research.py "topic"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Chrome not found | Ensure Chrome is at standard macOS path |
| Port 9222 in use | `lsof -i :9222` to check, kill stale process |
| Not logged in | Open Chrome automation profile, login to Google |
| Timeout | Increase `--timeout`, or check Gemini quota |

---
*Skill added: 2026-01-16*
