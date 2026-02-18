#!/usr/bin/env python3
"""CRM Updater - Updates contacts database from multi-source ingested data.

Gathers interactions from 5 sources (Telegram, Slack, Gmail, Calendar, Granola),
sends them to Claude for analysis and contact matching, then applies updates
to the CRM contacts.yaml database.
"""

import json
import os
import re
import shutil
import subprocess
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

import yaml
from rich.console import Console

from dotenv import load_dotenv

console = Console()

# Paths
VAULT_PATH = Path(os.environ.get("VAULT_PATH", ""))
INBOX_FOLDER = VAULT_PATH / "1 - Inbox (Last 7 days)"
TELEGRAM_FOLDER = INBOX_FOLDER / "Telegram"
SLACK_FOLDER = INBOX_FOLDER / "Slack" / "Channels"
GMAIL_FOLDER = INBOX_FOLDER / "Gmail"
CALENDAR_FOLDER = INBOX_FOLDER / "Calendar"
GRANOLA_FOLDER = INBOX_FOLDER / "Granola"
CRM_FILE = VAULT_PATH / "4 - CRM/contacts.yaml"
CRM_BACKUP_FOLDER = VAULT_PATH / "4 - CRM/backups"
AUDIT_LOG = VAULT_PATH / "4 - CRM/crm_audit.log"

# My identifiers (for detecting my messages across sources)
MY_IDENTIFIERS = os.environ.get("MY_IDENTIFIERS", "the user").split(",")
MY_EMAIL = os.environ.get("MY_EMAIL", "")

# Fuzzy matching thresholds (kept for fallback)
HIGH_CONFIDENCE_THRESHOLD = 0.95
LOW_CONFIDENCE_THRESHOLD = 0.6
AMBIGUITY_DELTA = 0.05

# Claude context limit (~50K chars to stay within window)
MAX_CONTEXT_CHARS = 50_000


# ---------------------------------------------------------------------------
# Utility functions (preserved from original)
# ---------------------------------------------------------------------------


def log_audit(message: str):
    """Log to audit file."""
    timestamp = datetime.now().isoformat()
    with open(AUDIT_LOG, "a") as f:
        f.write(f"[{timestamp}] {message}\n")


def fuzzy_match_score(name1: str, name2: str) -> float:
    """Calculate fuzzy match score between two names."""
    name1 = name1.lower().strip()
    name2 = name2.lower().strip()

    # Exact match
    if name1 == name2:
        return 1.0

    words1 = name1.split()
    words2 = name2.split()

    score = SequenceMatcher(None, name1, name2).ratio()

    # One contains the other
    if name1 in name2 or name2 in name1:
        score = max(score, 0.9)

    # Word overlap
    common = set(words1) & set(words2)
    if common:
        significant_common = [w for w in common if len(w) > 2]
        if significant_common:
            score = max(score, 0.85)

    # Penalize mismatched last names when both are multi-word names
    if len(words1) >= 2 and len(words2) >= 2:
        if words1[-1] != words2[-1]:
            score = min(score, 0.79)

    return score


def is_my_message(sender: str) -> bool:
    """Check if sender is me (Telegram context)."""
    sender_lower = sender.lower()
    return any(ident in sender_lower for ident in MY_IDENTIFIERS)


def is_my_email(email: str) -> bool:
    """Check if an email address is mine."""
    return email.lower().strip() == MY_EMAIL


def load_crm() -> dict:
    """Load CRM database."""
    if not CRM_FILE.exists():
        return {"metadata": {}, "contacts": []}

    with open(CRM_FILE) as f:
        return yaml.safe_load(f) or {"metadata": {}, "contacts": []}


def save_crm(crm: dict):
    """Save CRM database with backup."""
    # Create backup
    if CRM_FILE.exists():
        CRM_BACKUP_FOLDER.mkdir(parents=True, exist_ok=True)
        backup_name = f"contacts_{datetime.now().strftime('%Y%m%d_%H%M%S')}.yaml"
        shutil.copy(CRM_FILE, CRM_BACKUP_FOLDER / backup_name)

        # Keep only last 30 backups
        backups = sorted(CRM_BACKUP_FOLDER.glob("contacts_*.yaml"))
        for old_backup in backups[:-30]:
            old_backup.unlink()

    # Update metadata
    crm["metadata"]["last_updated"] = datetime.now(UTC).isoformat()
    crm["metadata"]["total_contacts"] = len(crm["contacts"])

    # Save
    with open(CRM_FILE, "w") as f:
        yaml.dump(crm, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def find_contact_by_telegram_id(crm: dict, telegram_id: int) -> dict | None:
    """Find a contact by exact telegram_id match only."""
    if not telegram_id:
        return None
    for contact in crm.get("contacts", []):
        if contact.get("telegram_id") == telegram_id:
            return contact
    return None


def find_contact(crm: dict, telegram_id: int = None, name: str = None) -> tuple[dict | None, float, dict | None, float]:
    """Find a contact by telegram_id or name. Returns (best_contact, best_score, second_contact, second_score)."""
    contacts = crm.get("contacts", [])

    # Try telegram_id first (exact match) - this is authoritative
    if telegram_id:
        for contact in contacts:
            if contact.get("telegram_id") == telegram_id:
                return contact, 1.0, None, 0.0

    # Try name fuzzy match
    if name:
        best_match = None
        second_match = None
        best_score = 0.0
        second_score = 0.0

        for contact in contacts:
            contact_name = contact.get("name", "")
            score = fuzzy_match_score(name, contact_name)
            if score > best_score:
                second_score = best_score
                second_match = best_match
                best_score = score
                best_match = contact
            elif score > second_score:
                second_score = score
                second_match = contact

        if best_score >= 0.6:
            return best_match, best_score, second_match, second_score

    return None, 0.0, None, 0.0


def generate_next_id(crm: dict) -> str:
    """Generate next contact ID."""
    existing_ids = [c.get("id", "") for c in crm.get("contacts", [])]
    max_num = 0
    for cid in existing_ids:
        if cid.startswith("c_"):
            try:
                num = int(cid[2:])
                max_num = max(max_num, num)
            except ValueError:
                pass
    return f"c_{max_num + 1:03d}"


# ---------------------------------------------------------------------------
# Phase 1: Multi-source interaction gathering
# ---------------------------------------------------------------------------


def _make_interaction(
    source: str,
    contact_name: str = None,
    contact_email: str = None,
    telegram_id: int = None,
    interaction_type: str = "message",
    summary: str = None,
    date: str = None,
) -> dict:
    """Create a standardized interaction dict."""
    return {
        "source": source,
        "contact_name": contact_name,
        "contact_email": contact_email,
        "telegram_id": telegram_id,
        "interaction_type": interaction_type,
        "summary": summary,
        "date": date or datetime.now().strftime("%Y-%m-%d"),
    }


def gather_telegram_interactions() -> list[dict]:
    """Read Telegram private DMs from Vault/1 - Inbox (Last 7 days)/Telegram/*.md.

    Only processes type: private conversations where the user sent messages.
    Extracts telegram_id from frontmatter, sender names, last messages.
    """
    interactions = []

    if not TELEGRAM_FOLDER.exists():
        return interactions

    for md_file in TELEGRAM_FOLDER.glob("*.md"):
        try:
            content = md_file.read_text()
        except OSError as e:
            console.print(f"[dim]Skipping {md_file.name}: {e}[/dim]")
            continue

        # Extract frontmatter
        telegram_id = None
        chat_type = "unknown"

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                try:
                    frontmatter = yaml.safe_load(parts[1]) or {}
                    telegram_id = frontmatter.get("telegram_id")
                    if telegram_id:
                        telegram_id = int(telegram_id)
                    chat_type = frontmatter.get("type", "unknown")
                except (yaml.YAMLError, ValueError):
                    pass

        # Only process private chats
        if chat_type != "private":
            continue

        # Extract conversation name
        conv_name_match = re.search(r"^# (.+)$", content, re.MULTILINE)
        conv_name = conv_name_match.group(1) if conv_name_match else md_file.stem

        # Find the most recent date
        current_date = None
        for line in content.split("\n"):
            date_match = re.match(r"^## (\d{4}-\d{2}-\d{2})$", line)
            if date_match:
                current_date = date_match.group(1)
                break

        # Parse messages
        msg_pattern = r"### (\d{2}:\d{2}) - (.+?)\n([\s\S]*?)(?=\n### |\n## |\Z)"
        messages = []
        for match in re.finditer(msg_pattern, content):
            sender = match.group(2).strip()
            text = match.group(3).strip()
            messages.append({
                "sender": sender,
                "text": text[:500],
                "is_me": is_my_message(sender),
            })

        my_messages = [m for m in messages if m["is_me"]]
        their_messages = [m for m in messages if not m["is_me"]]

        # Only include if user sent messages
        if not my_messages:
            continue

        last_them = their_messages[0]["text"] if their_messages else None
        last_me = my_messages[0]["text"] if my_messages else None

        summary_parts = []
        if last_them:
            sender_name = their_messages[0]["sender"] if their_messages else conv_name
            summary_parts.append(f"From {sender_name}: {last_them[:200]}")
        if last_me:
            summary_parts.append(f"My reply: {last_me[:200]}")

        interactions.append(_make_interaction(
            source="telegram",
            contact_name=conv_name,
            telegram_id=telegram_id,
            interaction_type="dm",
            summary=" | ".join(summary_parts) if summary_parts else f"DM with {conv_name}",
            date=current_date,
        ))

    return interactions


def gather_slack_interactions() -> list[dict]:
    """Parse Slack channel files for today: Vault/1 - Inbox (Last 7 days)/Slack/Channels/{today}*.md.

    Extracts sender names from markdown tables (Time | Sender | Message).
    Skips bot messages (names ending with 'bot' or containing 'app').
    """
    interactions = []
    today = datetime.now().strftime("%Y-%m-%d")

    if not SLACK_FOLDER.exists():
        return interactions

    for md_file in SLACK_FOLDER.glob(f"{today}*.md"):
        try:
            content = md_file.read_text()
        except OSError as e:
            console.print(f"[dim]Skipping {md_file.name}: {e}[/dim]")
            continue

        # Extract channel name from header: # Slack #channel-name -- date
        channel = md_file.stem
        channel_match = re.search(r"#\s*Slack\s+#([\w-]+)", content)
        if channel_match:
            channel = channel_match.group(1)

        # Parse table rows: | Time | Sender | Message |
        table_pattern = r"^\|\s*(\d{1,2}:\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$"
        senders_seen = {}  # sender -> list of messages

        for line in content.split("\n"):
            match = re.match(table_pattern, line)
            if not match:
                continue

            sender = match.group(2).strip()
            message = match.group(3).strip()

            # Skip header separator and bot messages
            if sender == "Sender" or "---" in sender:
                continue
            sender_lower = sender.lower()
            if sender_lower.endswith("bot") or "app" in sender_lower:
                continue
            # Skip my own messages
            if any(ident in sender_lower for ident in MY_IDENTIFIERS):
                continue

            if sender not in senders_seen:
                senders_seen[sender] = []
            senders_seen[sender].append(message[:200])

        # Create one interaction per unique sender in the channel
        for sender, messages in senders_seen.items():
            interactions.append(_make_interaction(
                source="slack",
                contact_name=sender,
                interaction_type="slack_message",
                summary=f"#{channel}: {messages[0][:200]}",
                date=today,
            ))

    return interactions


def gather_gmail_interactions() -> list[dict]:
    """Parse Gmail digest: Vault/1 - Inbox (Last 7 days)/Gmail/{today}.md.

    Extracts sender emails and subjects from the markdown table.
    """
    interactions = []
    today = datetime.now().strftime("%Y-%m-%d")
    gmail_file = GMAIL_FOLDER / f"{today}.md"

    if not gmail_file.exists():
        return interactions

    try:
        content = gmail_file.read_text()
    except OSError as e:
        console.print(f"[dim]Skipping Gmail file: {e}[/dim]")
        return interactions

    # Parse table: | Time | Sender | Subject |
    table_pattern = r"^\|\s*(\d{1,2}:\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$"

    for line in content.split("\n"):
        match = re.match(table_pattern, line)
        if not match:
            continue

        sender = match.group(2).strip()
        subject = match.group(3).strip()

        # Skip header/separator rows
        if sender == "Sender" or "---" in sender:
            continue

        # Skip my own emails
        if is_my_email(sender):
            continue

        # Clean up bold markers from subject
        subject = subject.replace("**", "")

        # Determine if sender is email or name
        contact_email = sender if "@" in sender else None
        contact_name = None if "@" in sender else sender

        interactions.append(_make_interaction(
            source="gmail",
            contact_name=contact_name,
            contact_email=contact_email,
            interaction_type="email",
            summary=f"Email: {subject[:200]}",
            date=today,
        ))

    return interactions


def gather_calendar_interactions() -> list[dict]:
    """Parse Calendar file: Vault/1 - Inbox (Last 7 days)/Calendar/{today}.md.

    Extracts attendee emails from the events table.
    """
    interactions = []
    today = datetime.now().strftime("%Y-%m-%d")
    cal_file = CALENDAR_FOLDER / f"{today}.md"

    if not cal_file.exists():
        return interactions

    try:
        content = cal_file.read_text()
    except OSError as e:
        console.print(f"[dim]Skipping Calendar file: {e}[/dim]")
        return interactions

    # Parse table: | Time | Event | Attendees | Link |
    table_pattern = r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$"

    for line in content.split("\n"):
        match = re.match(table_pattern, line)
        if not match:
            continue

        time_str = match.group(1).strip()
        event = match.group(2).strip()
        attendees_str = match.group(3).strip()

        # Skip header/separator rows
        if event == "Event" or "---" in event:
            continue

        # Parse attendees (comma-separated emails)
        attendees = [a.strip() for a in attendees_str.split(",") if a.strip()]

        for attendee in attendees:
            # Skip my own email
            if is_my_email(attendee):
                continue
            # Skip non-email entries
            if "@" not in attendee:
                continue

            interactions.append(_make_interaction(
                source="calendar",
                contact_email=attendee,
                interaction_type="meeting",
                summary=f"Calendar: {event[:200]}",
                date=today,
            ))

    return interactions


def gather_granola_interactions() -> list[dict]:
    """Read Granola meeting metadata: Vault/1 - Inbox (Last 7 days)/Granola/{today}_*/metadata.json.

    Extracts attendee emails from metadata.json files in recent meeting folders.
    """
    interactions = []
    today = datetime.now().strftime("%Y-%m-%d")

    if not GRANOLA_FOLDER.exists():
        return interactions

    for meta_file in GRANOLA_FOLDER.glob(f"{today}_*/metadata.json"):
        try:
            data = json.loads(meta_file.read_text())
        except (json.JSONDecodeError, OSError) as e:
            console.print(f"[dim]Skipping {meta_file.name}: {e}[/dim]")
            continue

        title = data.get("title", "Untitled meeting")
        meeting_date = data.get("date", today)
        # Normalize date to YYYY-MM-DD if it's an ISO timestamp
        if "T" in str(meeting_date):
            meeting_date = str(meeting_date)[:10]

        attendees = data.get("attendees", [])
        for attendee in attendees:
            if not isinstance(attendee, str):
                continue
            # Skip my own email
            if is_my_email(attendee):
                continue

            interactions.append(_make_interaction(
                source="granola",
                contact_email=attendee,
                interaction_type="meeting",
                summary=f"Granola meeting: {title[:200]}",
                date=meeting_date,
            ))

    return interactions


# ---------------------------------------------------------------------------
# Phase 2: Claude-powered analysis
# ---------------------------------------------------------------------------


def _build_claude_context(interactions: list[dict], crm: dict) -> str:
    """Build a context string for Claude with interactions and existing contacts.

    Truncates to MAX_CONTEXT_CHARS to fit within Claude's window.
    """
    parts = []

    # Section 1: Existing CRM contacts (compact format)
    contacts = crm.get("contacts", [])
    if contacts:
        parts.append("=== EXISTING CRM CONTACTS ===")
        for c in contacts:
            fields = [
                f"id:{c.get('id', '?')}",
                f"name:{c.get('name', '?')}",
            ]
            if c.get("email"):
                fields.append(f"email:{c['email']}")
            if c.get("telegram_id"):
                fields.append(f"tg_id:{c['telegram_id']}")
            if c.get("company"):
                fields.append(f"company:{c['company']}")
            if c.get("relationship"):
                fields.append(f"rel:{c['relationship']}")
            if c.get("last_connection"):
                fields.append(f"last:{c['last_connection']}")
            if c.get("sources"):
                fields.append(f"sources:{','.join(c['sources'])}")
            parts.append(" | ".join(fields))
        parts.append("")

    # Section 2: Today's interactions
    parts.append("=== TODAY'S INTERACTIONS ===")
    for i, ix in enumerate(interactions):
        fields = [f"[{i}] source:{ix['source']}"]
        if ix.get("contact_name"):
            fields.append(f"name:{ix['contact_name']}")
        if ix.get("contact_email"):
            fields.append(f"email:{ix['contact_email']}")
        if ix.get("telegram_id"):
            fields.append(f"tg_id:{ix['telegram_id']}")
        fields.append(f"type:{ix['interaction_type']}")
        if ix.get("summary"):
            fields.append(f"summary:{ix['summary'][:300]}")
        if ix.get("date"):
            fields.append(f"date:{ix['date']}")
        parts.append(" | ".join(fields))

    context = "\n".join(parts)

    # Truncate if needed
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n\n[TRUNCATED - context exceeded limit]"

    return context


def analyze_with_claude(interactions: list[dict], crm: dict) -> dict | None:
    """Send all gathered interactions + existing CRM contacts to Claude for analysis.

    Claude will:
    - Match interactions to existing contacts (by email, telegram_id, or fuzzy name)
    - Suggest next steps for each contact with recent activity
    - Identify new contacts to create
    - Return structured JSON

    Returns parsed JSON response or None on failure.
    """
    if not interactions:
        console.print("[dim]No interactions to analyze.[/dim]")
        return None

    context = _build_claude_context(interactions, crm)

    prompt = f"""You are a CRM assistant. Analyze today's interactions and match them to existing contacts.

{context}

=== INSTRUCTIONS ===

1. Match each interaction to an existing CRM contact by:
   - Exact email match (highest priority)
   - Exact telegram_id match (high priority)
   - Fuzzy name match (use judgment - "John Smith" matches "John Smith" but not "John Adams")

2. For each matched contact with activity today, suggest a brief actionable next step.
   Examples: "Follow up on proposal", "Schedule call", "Send requested document"
   If no action needed: "None - conversation complete" or "None - waiting for response"

3. Identify interactions that don't match any existing contact - these are new contacts to create.

4. For interactions from multiple sources that refer to the SAME person, group them.

Respond with ONLY valid JSON in this exact structure:
{{
  "updates": [
    {{
      "contact_id": "c_001",
      "matched_interactions": [0, 3],
      "next_step": "Follow up on proposal by Thursday",
      "add_sources": ["slack", "gmail"],
      "set_email": "person@example.com",
      "set_telegram_id": null,
      "last_connection": "YYYY-MM-DD"
    }}
  ],
  "new_contacts": [
    {{
      "name": "New Person",
      "email": "new@example.com",
      "telegram_id": null,
      "sources": ["gmail"],
      "interaction_summary": "Emailed about partnership",
      "next_step": "Reply to introduction email",
      "last_connection": "YYYY-MM-DD"
    }}
  ],
  "skipped": [
    {{
      "interaction_index": 5,
      "reason": "Bot or automated message"
    }}
  ]
}}

Rules:
- contact_id must reference an existing contact's id field
- matched_interactions are indices from the interactions list above
- add_sources: only add sources not already on the contact
- set_email/set_telegram_id: only set if the contact doesn't already have one
- For new_contacts, always include name and at least one of email/telegram_id
- Do NOT create new contacts for people who clearly match existing ones
- last_connection should be the date of the most recent interaction
"""

    # Use Claude Code CLI with subscription billing
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)  # Force subscription billing
    env.pop("CLAUDECODE", None)  # Allow nested Claude invocation

    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--model", "opus", "--output-format", "json"],
            capture_output=True,
            text=True,
            env=env,
            timeout=180,
        )

        if result.returncode != 0:
            console.print(f"[red]Claude analysis error: {result.stderr[:500]}[/red]")
            log_audit(f"Claude analysis failed: exit code {result.returncode}")
            return None

        response_text = result.stdout.strip()

    except subprocess.TimeoutExpired:
        console.print("[red]Claude analysis timed out (180s)[/red]")
        log_audit("Claude analysis timed out")
        return None
    except Exception as e:
        console.print(f"[red]Claude analysis failed: {e}[/red]")
        log_audit(f"Claude analysis exception: {e}")
        return None

    # Parse JSON response - with --output-format json, the output is a JSON object
    # with a "result" field containing the actual text response
    try:
        outer = json.loads(response_text)
        # claude --output-format json wraps result in {"type":"result","result":"..."}
        if isinstance(outer, dict) and "result" in outer:
            inner_text = outer["result"]
        else:
            inner_text = response_text

        # The inner text may contain the JSON we want, possibly with markdown fences
        inner_text = inner_text.strip()
        if inner_text.startswith("```"):
            # Remove markdown code fences
            inner_text = re.sub(r"^```(?:json)?\s*\n?", "", inner_text)
            inner_text = re.sub(r"\n?```\s*$", "", inner_text)
            inner_text = inner_text.strip()

        analysis = json.loads(inner_text)

        # Validate expected structure
        if not isinstance(analysis, dict):
            raise ValueError("Response is not a JSON object")
        if "updates" not in analysis and "new_contacts" not in analysis:
            raise ValueError("Response missing 'updates' and 'new_contacts' keys")

        return analysis

    except (json.JSONDecodeError, ValueError) as e:
        console.print(f"[red]Failed to parse Claude response: {e}[/red]")
        log_audit(f"Claude response parse error: {e}")
        # Log first 500 chars for debugging
        log_audit(f"Raw response (first 500): {response_text[:500]}")
        return None


# ---------------------------------------------------------------------------
# Phase 3: Apply updates from Claude analysis
# ---------------------------------------------------------------------------


def apply_claude_analysis(analysis: dict, crm: dict, interactions: list[dict]) -> tuple[list, list]:
    """Apply Claude's structured analysis to the CRM.

    Returns (updated_contacts, new_contacts) lists.
    """
    updated_contacts = []
    new_contacts = []

    contacts_by_id = {c.get("id"): c for c in crm.get("contacts", []) if c.get("id")}

    # Apply updates to existing contacts
    for update in analysis.get("updates", []):
        contact_id = update.get("contact_id")
        if not contact_id or contact_id not in contacts_by_id:
            log_audit(f"Skipped update: unknown contact_id {contact_id}")
            continue

        contact = contacts_by_id[contact_id]

        # Update last_connection
        if update.get("last_connection"):
            contact["last_connection"] = update["last_connection"]

        # Update next_step
        if update.get("next_step"):
            contact["next_step"] = update["next_step"]

        # Add sources
        for src in update.get("add_sources", []):
            if src not in contact.get("sources", []):
                contact.setdefault("sources", []).append(src)

        # Set email if contact doesn't have one
        if update.get("set_email") and not contact.get("email"):
            contact["email"] = update["set_email"]

        # Set telegram_id if contact doesn't have one
        if update.get("set_telegram_id") and not contact.get("telegram_id"):
            contact["telegram_id"] = update["set_telegram_id"]

        # Build last_messages from matched interactions
        matched_ixs = update.get("matched_interactions", [])
        if matched_ixs:
            summaries = []
            for idx in matched_ixs:
                if 0 <= idx < len(interactions):
                    ix = interactions[idx]
                    summaries.append(f"[{ix['source']}] {ix.get('summary', '')[:200]}")
            if summaries:
                contact["last_messages"] = {
                    "them": " | ".join(summaries[:3]),
                    "me": contact.get("last_messages", {}).get("me"),
                }

        # Increment interaction count
        contact["interactions_365d"] = contact.get("interactions_365d", 0) + len(matched_ixs)

        updated_contacts.append(contact)
        log_audit(f"Updated: {contact['name']} (id: {contact_id}, sources: {contact.get('sources', [])})")

    # Create new contacts
    for new in analysis.get("new_contacts", []):
        name = new.get("name")
        if not name:
            continue

        # Safety check: don't create if we can fuzzy-match to existing
        _, score, _, _ = find_contact(
            crm,
            telegram_id=new.get("telegram_id"),
            name=name,
        )
        if score >= HIGH_CONFIDENCE_THRESHOLD:
            log_audit(f"Skipped new contact '{name}': fuzzy matched existing (score {score:.2f})")
            continue

        new_contact = {
            "id": generate_next_id(crm),
            "name": name,
            "company": None,
            "relationship": "1 - New connection",
            "hypothesis": "TBD",
            "last_connection": new.get("last_connection") or datetime.now().strftime("%Y-%m-%d"),
            "last_messages": {
                "me": None,
                "them": new.get("interaction_summary"),
            },
            "next_step": new.get("next_step"),
            "telegram_id": new.get("telegram_id"),
            "email": new.get("email"),
            "interactions_365d": 1,
            "sources": new.get("sources", []),
            "auto_created": True,
            "type": ["personal"],
            "deal_stage": None,
            "deal_value": None,
        }
        crm["contacts"].append(new_contact)
        new_contacts.append(new_contact)
        log_audit(f"Created: {new_contact['name']} (email: {new.get('email')}, sources: {new.get('sources', [])})")

    return updated_contacts, new_contacts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    """Main CRM update routine - multi-source gathering + Claude analysis."""
    console.print("[bold]CRM Update - Multi-source processing...[/bold]")
    log_audit("=== CRM Update Started (multi-source) ===")

    # Load .env for VAULT_PATH and other env vars
    env_file = Path(__file__).resolve().parents[3] / "dev" / "Ops" / ".env"
    if env_file.exists():
        load_dotenv(env_file, override=True)
    crm = load_crm()

    # Phase 1: Gather interactions from all sources
    console.print("\n[bold]Phase 1: Gathering interactions...[/bold]")

    all_interactions = []

    # 1. Telegram
    telegram_interactions = gather_telegram_interactions()
    all_interactions.extend(telegram_interactions)
    console.print(f"  Telegram: {len(telegram_interactions)} DM conversations")

    # 2. Slack
    slack_interactions = gather_slack_interactions()
    all_interactions.extend(slack_interactions)
    console.print(f"  Slack: {len(slack_interactions)} unique senders")

    # 3. Gmail
    gmail_interactions = gather_gmail_interactions()
    all_interactions.extend(gmail_interactions)
    console.print(f"  Gmail: {len(gmail_interactions)} emails")

    # 4. Calendar
    calendar_interactions = gather_calendar_interactions()
    all_interactions.extend(calendar_interactions)
    console.print(f"  Calendar: {len(calendar_interactions)} meeting attendees")

    # 5. Granola
    granola_interactions = gather_granola_interactions()
    all_interactions.extend(granola_interactions)
    console.print(f"  Granola: {len(granola_interactions)} meeting attendees")

    console.print(f"\n  Total: {len(all_interactions)} interactions from {_count_sources(all_interactions)} sources")
    log_audit(f"Gathered {len(all_interactions)} interactions from {_count_sources(all_interactions)} sources")

    if not all_interactions:
        console.print("[yellow]No interactions found. Nothing to update.[/yellow]")
        log_audit("=== CRM Update Complete: no interactions found ===\n")
        return

    # Phase 2: Claude analysis
    console.print("\n[bold]Phase 2: Claude analysis...[/bold]")
    analysis = analyze_with_claude(all_interactions, crm)

    if analysis:
        # Phase 3: Apply updates
        console.print("\n[bold]Phase 3: Applying updates...[/bold]")
        updated_contacts, new_contacts = apply_claude_analysis(analysis, crm, all_interactions)
    else:
        console.print("[yellow]Claude analysis unavailable - no updates applied.[/yellow]")
        log_audit("Claude analysis returned None - no updates applied")
        updated_contacts = []
        new_contacts = []

    # Save CRM (always save even if no changes, to update metadata timestamp)
    save_crm(crm)

    # Print summary
    skipped_count = len(analysis.get("skipped", [])) if analysis else 0
    console.print("\n[bold]CRM Update Complete:[/bold]")
    console.print(f"  Updated: {len(updated_contacts)} contacts")
    console.print(f"  Created: {len(new_contacts)} new contacts")
    console.print(f"  Skipped: {skipped_count} interactions")

    if new_contacts:
        console.print("\n[green]New contacts added:[/green]")
        for c in new_contacts:
            console.print(f"  - {c['name']} ({c.get('email') or c.get('telegram_id') or 'no identifier'})")

    if updated_contacts:
        console.print("\n[blue]Updated contacts:[/blue]")
        for c in updated_contacts:
            console.print(f"  - {c['name']} (sources: {', '.join(c.get('sources', []))})")

    log_audit(
        f"=== CRM Update Complete: {len(updated_contacts)} updated, "
        f"{len(new_contacts)} created, {skipped_count} skipped ===\n"
    )

    # Generate dashboard
    from .crm_dashboard import generate_dashboard

    generate_dashboard()
    console.print("[green]Dashboard updated.[/green]")


def _count_sources(interactions: list[dict]) -> int:
    """Count unique sources in interactions list."""
    return len({ix["source"] for ix in interactions})


if __name__ == "__main__":
    main()
