"""Codos Bot Configuration"""

import os
from pathlib import Path

from backend.codos_models.settings import settings
from backend.codos_utils.secrets import get_secrets_backend

_secrets = get_secrets_backend()

# Telegram Bot Token
BOT_TOKEN = _secrets.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN not set in secrets backend")

# Authorized user IDs (only these users can interact with the bot)
# Get your user ID by messaging @userinfobot on Telegram
AUTHORIZED_USERS = [int(uid.strip()) for uid in (_secrets.get("AUTHORIZED_USER_IDS") or "").split(",") if uid.strip()]

# Claude Code workspace directory
WORKSPACE_DIR = Path(os.getenv("CLAUDE_WORKSPACE", str(settings.get_vault_path())))

# Session storage
SESSIONS_FILE = Path(settings.codos_data_dir) / "codos-bot" / "sessions.json"

# Claude Code settings
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "claude")
CLAUDE_TIMEOUT = 300  # 5 minutes max per request
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "sonnet")

# AssemblyAI for voice transcription
ASSEMBLYAI_API_KEY = _secrets.get("ASSEMBLYAI_API_KEY") or ""

# Anthropic API for image analysis
ANTHROPIC_API_KEY = _secrets.get("ANTHROPIC_API_KEY") or ""
