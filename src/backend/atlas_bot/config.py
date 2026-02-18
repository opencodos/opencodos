"""Atlas Bot Configuration"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from central secrets file
CENTRAL_ENV = Path(os.environ.get("ATLAS_ENV_FILE", str(Path(__file__).parents[3] / "dev" / "Ops" / ".env")))
load_dotenv(CENTRAL_ENV)

# Telegram Bot Token
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN not set in .env")

# Authorized user IDs (only these users can interact with the bot)
# Get your user ID by messaging @userinfobot on Telegram
AUTHORIZED_USERS = [int(uid.strip()) for uid in os.getenv("AUTHORIZED_USER_IDS", "").split(",") if uid.strip()]

# Claude Code workspace directory
WORKSPACE_DIR = Path(os.getenv("CLAUDE_WORKSPACE", os.getenv("VAULT_PATH", "")))

# Session storage
_data_dir = os.environ.get("ATLAS_DATA_DIR")
SESSIONS_FILE = (
    Path(_data_dir) / "atlas-bot" / "sessions.json" if _data_dir else Path(__file__).parent / "sessions.json"
)

# Claude Code settings
# Use 'claude' and let shell resolve it, or use full path with node
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "claude")
CLAUDE_TIMEOUT = 300  # 5 minutes max per request
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "sonnet")  # Default model

# AssemblyAI for voice transcription
ASSEMBLYAI_API_KEY = os.getenv("ASSEMBLYAI_API_KEY", "")

# Anthropic API for image analysis
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
