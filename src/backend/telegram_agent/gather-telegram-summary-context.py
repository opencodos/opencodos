#!/usr/bin/env python3
"""
Gather Telegram summary context for Claude Code processing.

This script extracts all context gathering logic from daily_summary.py
and outputs formatted markdown to stdout, suitable for Claude Code to process.

Usage:
    python gather-telegram-summary-context.py

Environment variables:
    VAULT_PATH - Path to Obsidian Vault (default: ~/Documents/Obsidian Vault)
    CODOS_PATH - Path to codos directory (default: ~/Projects/codos)
"""

import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

import yaml

# Paths from environment with defaults
VAULT_PATH = Path(os.environ.get("VAULT_PATH", ""))
CODOS_PATH = Path(os.environ.get("CODOS_PATH", ""))

TELEGRAM_FOLDER = VAULT_PATH / "1 - Inbox (Last 7 days)/Telegram"
PRIORITY_CONFIG = CODOS_PATH / "src/backend/telegram_agent/priority_contacts.yaml"
GOALS_PATH = VAULT_PATH / "Core Memory/Goals.md"
CONTACTS_PATH = VAULT_PATH / "4 - CRM/contacts.yaml"


def load_priority_contacts() -> dict:
    """Load priority contacts configuration."""
    if not PRIORITY_CONFIG.exists():
        return {"tier_1": [], "tier_2": [], "priority_groups": []}

    with open(PRIORITY_CONFIG) as f:
        return yaml.safe_load(f) or {}


def load_current_context() -> str:
    """Load current priorities from Goals.md for prompt context."""
    if not GOALS_PATH.exists():
        return ""

    content = GOALS_PATH.read_text()

    # Extract short-term goals section
    match = re.search(r"### Short-term goals\n([\s\S]*?)(?=\n### |\Z)", content)
    if match:
        return match.group(1).strip()
    return ""


def load_contact_mapping() -> dict:
    """Load contact->project mapping from CRM contacts.yaml."""
    if not CONTACTS_PATH.exists():
        return {"contact_to_projects": {}, "personal_contacts": [], "projects": os.environ.get("PROJECT_LIST", "Project A,Project B,Project C").split(",")}

    with open(CONTACTS_PATH) as f:
        data = yaml.safe_load(f) or {}

    mapping = {"contact_to_projects": {}, "personal_contacts": [], "projects": os.environ.get("PROJECT_LIST", "Project A,Project B,Project C").split(",")}

    for contact in data.get("contacts", []):
        name = contact.get("name", "")
        if not name:
            continue

        # Map projects
        projects = contact.get("projects", [])
        if projects:
            mapping["contact_to_projects"][name] = projects

        # Track personal contacts
        if contact.get("category") == "personal":
            mapping["personal_contacts"].append(name)

    return mapping


def fuzzy_match(name: str, contacts: list[str]) -> bool:
    """Check if name fuzzy-matches any contact in list."""
    name_lower = name.lower()
    for contact in contacts:
        contact_lower = contact.lower()
        # Check if contact name is contained in the sender name or vice versa
        if contact_lower in name_lower or name_lower in contact_lower:
            return True
        # Check individual words
        contact_words = contact_lower.split()
        for word in contact_words:
            if len(word) > 2 and word in name_lower:
                return True
    return False


def parse_messages_from_file(file_path: Path) -> list[dict]:
    """Parse messages from a markdown file."""
    content = file_path.read_text()
    messages = []

    # Extract conversation name from first heading
    conv_name_match = re.search(r"^# (.+)$", content, re.MULTILINE)
    conv_name = conv_name_match.group(1) if conv_name_match else file_path.stem

    # Extract chat type from frontmatter
    chat_type = "unknown"
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            try:
                frontmatter = yaml.safe_load(parts[1]) or {}
                chat_type = frontmatter.get("type", "unknown")
            except yaml.YAMLError:
                pass

    # Parse messages: ### HH:MM - Sender Name
    pattern = r"### (\d{2}:\d{2}) - (.+?)\n([\s\S]*?)(?=\n### |\n## |\Z)"

    for match in re.finditer(pattern, content):
        time_str = match.group(1)
        sender = match.group(2).strip()
        text = match.group(3).strip()

        if text:
            messages.append(
                {
                    "conversation": conv_name,
                    "chat_type": chat_type,
                    "sender": sender,
                    "time": time_str,
                    "text": text[:500],  # Truncate long messages
                    "file_path": str(file_path),
                }
            )

    return messages


def get_recent_messages(hours: int = 24) -> list[dict]:
    """Get all messages from files modified in the last N hours."""
    cutoff = datetime.now() - timedelta(hours=hours)
    all_messages = []

    # Scan all subfolders
    for md_file in TELEGRAM_FOLDER.rglob("*.md"):
        # Skip summary files
        if "Daily Summary" in str(md_file):
            continue

        # Check modification time
        mtime = datetime.fromtimestamp(md_file.stat().st_mtime)
        if mtime > cutoff:
            messages = parse_messages_from_file(md_file)
            all_messages.extend(messages)

    return all_messages


def categorize_messages(messages: list[dict], priority_config: dict) -> dict:
    """Categorize messages by priority tier."""
    tier_1 = priority_config.get("tier_1", [])
    tier_2 = priority_config.get("tier_2", [])
    priority_groups = priority_config.get("priority_groups", [])

    categorized = {
        "high": [],
        "medium": [],
        "low": [],
    }

    for msg in messages:
        sender = msg["sender"]
        conv = msg["conversation"]
        chat_type = msg["chat_type"]

        # Check if it's a priority group
        is_priority_group = any(pg.lower() in conv.lower() for pg in priority_groups) if priority_groups else False

        # DMs from tier 1 contacts -> high priority
        if chat_type == "private" and fuzzy_match(sender, tier_1):
            categorized["high"].append(msg)
        # Priority groups -> high priority
        elif is_priority_group:
            categorized["high"].append(msg)
        # DMs from tier 2 contacts -> medium priority
        elif chat_type == "private" and fuzzy_match(sender, tier_2):
            categorized["medium"].append(msg)
        # Other DMs -> medium priority
        elif chat_type == "private":
            categorized["medium"].append(msg)
        # Group messages from tier 1 contacts -> medium priority
        elif fuzzy_match(sender, tier_1):
            categorized["medium"].append(msg)
        # Everything else -> low priority
        else:
            categorized["low"].append(msg)

    return categorized


def group_by_conversation(messages: list[dict]) -> dict[str, list[dict]]:
    """Group messages by conversation."""
    grouped = {}
    for msg in messages:
        conv = msg["conversation"]
        if conv not in grouped:
            grouped[conv] = []
        grouped[conv].append(msg)
    return grouped


def build_messages_context(categorized: dict) -> str:
    """Build formatted messages context string."""
    context_parts = []

    for priority, label in [("high", "HIGH PRIORITY"), ("medium", "MEDIUM PRIORITY"), ("low", "LOW PRIORITY")]:
        messages = categorized.get(priority, [])
        if not messages:
            continue

        grouped = group_by_conversation(messages)
        context_parts.append(f"\n=== {label} ({len(messages)} messages) ===\n")

        for conv, msgs in grouped.items():
            context_parts.append(f"\n## {conv} ({msgs[0]['chat_type']})")
            for msg in msgs[:10]:  # Limit messages per conversation
                context_parts.append(f"- [{msg['time']}] {msg['sender']}: {msg['text'][:200]}")

    return "\n".join(context_parts)


def build_contact_mapping_context(contact_mapping: dict) -> str:
    """Build formatted contact mapping context string."""
    mapping_lines = []
    mapping_lines.append(f"Projects: {', '.join(contact_mapping['projects'])}")
    mapping_lines.append("\nContact associations:")
    for name, projects in contact_mapping["contact_to_projects"].items():
        mapping_lines.append(f"- {name} -> {', '.join(projects)}")
    mapping_lines.append(f"\nPersonal contacts (Family & Friends): {', '.join(contact_mapping['personal_contacts'])}")
    return "\n".join(mapping_lines)


def gather_context(hours: int = 24) -> dict:
    """Gather all context needed for Telegram summary generation.

    Returns:
        dict with keys:
        - current_priorities: Short-term goals from About me.md
        - contact_mapping: Contact->project mapping context
        - messages_context: Formatted messages by priority
        - message_count: Total number of messages
        - high_count, medium_count, low_count: Messages per priority
    """
    priority_config = load_priority_contacts()

    # Get recent messages
    messages = get_recent_messages(hours=hours)

    if not messages:
        return {
            "current_priorities": "",
            "contact_mapping": "",
            "messages_context": "",
            "message_count": 0,
            "high_count": 0,
            "medium_count": 0,
            "low_count": 0,
        }

    # Categorize by priority
    categorized = categorize_messages(messages, priority_config)

    # Load additional context
    current_context = load_current_context()
    contact_mapping = load_contact_mapping()

    return {
        "current_priorities": current_context,
        "contact_mapping": build_contact_mapping_context(contact_mapping),
        "messages_context": build_messages_context(categorized),
        "message_count": len(messages),
        "high_count": len(categorized["high"]),
        "medium_count": len(categorized["medium"]),
        "low_count": len(categorized["low"]),
    }


def format_prompt(context: dict) -> str:
    """Format the full prompt for Claude to process."""
    if context["message_count"] == 0:
        return "No new messages in the last 24 hours."

    prompt = f"""Analyze these Telegram messages from the last 24 hours.

## YOUR OWNER'S CURRENT PRIORITIES
{context["current_priorities"]}

## CONTACT->PROJECT MAPPING
{context["contact_mapping"]}

## MESSAGES TO ANALYZE
{context["messages_context"]}

## CRISIS SIGNAL DETECTION

BEFORE writing the summary, scan ALL messages for these crisis patterns. If ANY match, include them in a "## CRISIS SIGNALS" section at the TOP of output (before Executive Summary).

**CRISIS PATTERNS (always escalate):**
- Investor conflict: "capital return", "refund", "exit deal", "give money back"
- Legal/contractual: "lawsuit", "breach", "terminate", "legal action"
- Hard deadlines: "deadline", "expires", "must decide by [date]", "last chance"
- Key person departures: "leaving", "quitting", "stepping down", "resigning"
- Money at risk: amounts >$10k with negative context
- Relationship rupture with investors, cofounders, or key clients

**CRISIS SIGNALS format (if any found):**
## CRISIS SIGNALS

| Signal | Source | Quote | Urgency |
|--------|--------|-------|---------|
| [Signal type] | [Contact] DM | "[exact quote]" | [Urgency level + deadline if known] |

If no crisis signals detected, omit this section entirely.

## OUTPUT FORMAT

### Messages Needing Response
CRITICAL: Before writing the project sections, extract ALL messages where the user needs to respond. These are messages where:
1. **Ball in user's court** — they sent the last message and are waiting for a reply
2. **High-stakes** — from Tier 1 contacts (investors, cofounders, key clients)
3. **Time-sensitive** — contains deadlines, questions, or requests

For each conversation needing response, output:

#### [Contact Name] (@telegram_handle)
- **Context**: [Relationship, company, what's being discussed]
- **Last message time**: [HH:MM]
- **Their message**: "[EXACT full message text — do NOT summarize]"
- **Ball in court**: User / Them
- **Urgency**: HIGH / MEDIUM / LOW

If the user sent the last message and they haven't replied, skip it — ball is with them.
If no messages need response, write "No pending responses."

Group all updates by PROJECT using the Contact->Project Mapping above.

### Executive Summary
2-3 bullets of what actually matters for the priorities above. If nothing important happened, say "No significant updates in the last 24 hours."

### Telegram

**Codos**
- [Updates related to Codos project, or "No updates"]

**[Project 2]**
- [Updates related to project, or "No updates"]

**[Project 3]**
- [Updates related to project, or "No updates"]

**Family & Friends**
- [Personal messages from contacts marked as personal, or "No updates"]

**Other**
- [Updates from contacts not mapped to any project - use for general group chat noise, or "No updates"]

For each project section with DM activity, use this format for important conversations:
#### [Contact Name] | [Organization if known]
- **Context**: What is being discussed
- **Key points**: Important information shared
- **Action needed**: Any follow-up required (or "None")

---

CRITICAL RULES:
1. Group by PROJECT, not by priority level
2. Multi-project contacts: Place in most relevant project based on message content
3. Personal contacts: Messages from contacts with category=personal go in "Family & Friends"
4. Unmapped contacts: Group chatter from unknown contacts goes in "Other"
5. If a project section has no updates, write "No updates" - don't skip the section
6. Be specific: Quote actual messages, name actual people
7. Focus on DMs over group chats - groups go in "Other" unless directly relevant
"""
    return prompt


def main():
    """Gather context and output to stdout."""
    # Print to stderr for logging, stdout for context
    print("Reading messages from last 24 hours...", file=sys.stderr)

    context = gather_context(hours=24)

    print(f"Found {context['message_count']} messages", file=sys.stderr)
    print(f"  High priority: {context['high_count']}", file=sys.stderr)
    print(f"  Medium priority: {context['medium_count']}", file=sys.stderr)
    print(f"  Low priority: {context['low_count']}", file=sys.stderr)

    # Output the formatted prompt to stdout
    prompt = format_prompt(context)
    print(prompt)


if __name__ == "__main__":
    main()
