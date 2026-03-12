#!/usr/bin/env python3
"""
Gmail Sync - Fetches last 24h of emails using Composio SDK directly.

Usage: python3 gmail-sync.py

Outputs to: Vault/1 - Inbox (Last 7 days)/Gmail/{date}.md
"""

import os
from datetime import datetime
from pathlib import Path

# Load env from dev/Ops/.env (derive from this file's location)
_THIS_DIR = Path(__file__).parent
_CODOS_ROOT = _THIS_DIR.parent.parent  # Gmail -> ingestion -> codos
env_path = _CODOS_ROOT / "dev" / "Ops" / ".env"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ[key] = value

VAULT_ROOT = os.environ.get("VAULT_PATH", "")
OUTPUT_DIR = Path(VAULT_ROOT) / "1 - Inbox (Last 7 days)/Gmail"

# Skip noise
SKIP_SENDERS = ["noreply@", "notifications@", "marketing@", "no-reply@", "donotreply@", "newsletter@"]
SKIP_SUBJECTS = ["Your receipt", "Order confirmation", "Shipping notification"]


def get_date():
    return datetime.now().strftime("%Y-%m-%d")


def get_time():
    return datetime.now().strftime("%H:%M")


def fetch_emails():
    """Fetch emails using Composio SDK."""
    try:
        from composio import Composio
    except ImportError:
        print("Composio SDK not installed. Run: pip install composio")
        return []

    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        print("COMPOSIO_API_KEY not set")
        return []

    composio = Composio(api_key=api_key)

    try:
        result = composio.tools.execute(
            slug="GMAIL_FETCH_EMAILS",
            arguments={
                "query": "newer_than:1d",
                "max_results": 30,
                "ids_only": False,
            },
            user_id="default",
            dangerously_skip_version_check=True,
        )

        # Extract data from result
        data = result.get("data", {}) if isinstance(result, dict) else result
        if isinstance(data, dict):
            emails = data.get("emails", data.get("messages", []))
        elif isinstance(data, list):
            emails = data
        else:
            emails = []

        return emails
    except Exception as e:
        print(f"Failed to fetch emails: {e}")
        return []


def should_skip(email):
    sender = (email.get("sender", "") or email.get("from", "")).lower()
    subject = (email.get("subject", "") or "").lower()

    for pattern in SKIP_SENDERS:
        if pattern.lower() in sender:
            return True
    for pattern in SKIP_SUBJECTS:
        if pattern.lower() in subject:
            return True
    return False


def extract_sender_name(sender):
    if not sender:
        return "Unknown"
    # "Name <email>" -> "Name"
    if "<" in sender:
        return sender.split("<")[0].strip()
    # "email@domain" -> "email"
    if "@" in sender:
        return sender.split("@")[0]
    return sender


def format_time(date_str):
    if not date_str:
        return ""
    try:
        # Try various date formats
        for fmt in ["%Y-%m-%dT%H:%M:%S", "%a, %d %b %Y %H:%M:%S"]:
            try:
                dt = datetime.strptime(date_str[:19], fmt)
                return dt.strftime("%H:%M")
            except:
                pass
        return date_str[:5]
    except:
        return ""


def generate_markdown(emails):
    date = get_date()
    time = get_time()

    filtered = [e for e in emails if not should_skip(e)]
    unread_count = sum(1 for e in filtered if e.get("isUnread") or e.get("is_unread"))

    md = f"# Gmail — {date}\n\n"
    md += f"> Fetched: {date} {time}, last 24h\n\n"
    md += "## Emails\n\n"

    if not filtered:
        md += "No significant emails in the last 24h.\n\n"
    else:
        md += "| Time | Sender | Subject |\n"
        md += "|------|--------|--------|\n"

        for email in filtered:
            t = format_time(email.get("date", ""))
            sender = extract_sender_name(email.get("sender", email.get("from", "")))
            subject = (email.get("subject", "") or "").replace("|", "\\|").replace("\n", " ")[:100]
            is_unread = email.get("isUnread") or email.get("is_unread")
            marker = "**" if is_unread else ""

            md += f"| {t} | {sender} | {marker}{subject}{marker} |\n"

        md += "\n"

    md += "## Summary\n\n"
    md += f"- {len(filtered)} emails ({unread_count} unread)\n"
    md += f"- {len(emails) - len(filtered)} filtered out (newsletters, notifications)\n"

    # Action items
    actionable = [
        e
        for e in filtered
        if any(kw in (e.get("subject", "") or "").lower() for kw in ["action", "required", "urgent", "confirm"])
    ]

    if actionable:
        md += "\n### Action Required\n\n"
        for email in actionable:
            sender = extract_sender_name(email.get("sender", email.get("from", "")))
            subject = email.get("subject", "")
            md += f"- {sender}: {subject}\n"

    return md


def save_file(content):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = OUTPUT_DIR / f"{get_date()}.md"
    file_path.write_text(content, encoding="utf-8")
    return file_path


def main():
    date = get_date()
    print(f"Gmail sync: {date}")

    emails = fetch_emails()
    print(f"Found {len(emails)} total emails")

    markdown = generate_markdown(emails)
    file_path = save_file(markdown)

    print(f"Saved to: {file_path}")
    print("Gmail sync complete")


if __name__ == "__main__":
    main()
