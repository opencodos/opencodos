"""Sync logic for fetching and storing Telegram messages."""

import asyncio
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from rich.console import Console

from ..crm_update import find_contact, load_crm

from .config import Config, add_to_pending, add_to_whitelist, save_whitelist
from .obsidian import ObsidianWriter
from .telegram_client import Conversation, TelegramClientWrapper

console = Console()


@dataclass
class ConversationCheckpoint:
    latest_message_id: int
    latest_timestamp: float
    name: str


class SyncManager:
    """Manages syncing messages from Telegram to Obsidian."""

    CHECKPOINT_FILE = "checkpoint.json"

    def __init__(
        self,
        telegram: TelegramClientWrapper,
        obsidian: ObsidianWriter,
        config: Config,
    ):
        self.telegram = telegram
        self.obsidian = obsidian
        self.config = config
        self.checkpoint_path = config.base_path / self.CHECKPOINT_FILE
        self._semaphore = asyncio.Semaphore(2)  # 2 concurrent syncs - safe for rate limits
        self._checkpoint_lock = asyncio.Lock()

    def _load_checkpoint(self) -> dict[str, ConversationCheckpoint]:
        """Load sync checkpoint from file."""
        if not self.checkpoint_path.exists():
            return {}

        try:
            data = json.loads(self.checkpoint_path.read_text())
            return {
                conv_id: ConversationCheckpoint(
                    latest_message_id=cp["latest_message_id"],
                    latest_timestamp=cp["latest_timestamp"],
                    name=cp.get("name", ""),
                )
                for conv_id, cp in data.items()
            }
        except (json.JSONDecodeError, KeyError):
            return {}

    def _save_checkpoint(self, checkpoints: dict[str, ConversationCheckpoint]) -> None:
        """Save sync checkpoint to file."""
        data = {
            conv_id: {
                "latest_message_id": cp.latest_message_id,
                "latest_timestamp": cp.latest_timestamp,
                "name": cp.name,
            }
            for conv_id, cp in checkpoints.items()
        }
        self.checkpoint_path.write_text(json.dumps(data, indent=2))

    def _write_unread_summary(self, conversations: list[Conversation]) -> None:
        """Write a lightweight summary of unread conversations for AI suggestions.

        Instead of the suggestions script reading 64+ markdown files,
        it reads this single JSON with just the unread conversations and their recent messages.
        Enriches each conversation with related context from Granola, Gmail, Slack, Briefs, and Todos.
        """
        import re

        unread = [c for c in conversations if c.unread_count > 0]
        if not unread:
            summary_path = self.obsidian.vault_path / ".inbox-unread.json"
            summary_path.write_text(json.dumps({"conversations": [], "generated": datetime.now(UTC).isoformat()}, indent=2))
            return

        # Pre-load context sources for cross-referencing
        # obsidian.vault_path points to .../Telegram, go up to vault root
        vault_root = self.obsidian.vault_path.parent.parent
        context_sources = self._load_context_sources(vault_root)

        summaries = []
        for conv in unread:
            file_path = self.obsidian._get_file_path(conv.name, conv.type, conv.archived)
            if not file_path.exists():
                continue

            content = file_path.read_text()
            body = content
            if content.startswith("---"):
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    body = parts[2].strip()

            # Extract messages (newest-first in file)
            all_msgs: list[str] = []
            current_msg: list[str] = []
            for line in body.splitlines():
                if line.startswith("### ") and re.match(r"### \d{2}:\d{2}", line):
                    if current_msg:
                        all_msgs.append("\n".join(current_msg))
                    current_msg = [line]
                elif current_msg:
                    current_msg.append(line)
            if current_msg:
                all_msgs.append("\n".join(current_msg))

            # Split into unread (newest N) and context (older ones)
            n = conv.unread_count
            unread_msgs = all_msgs[:n] if n <= len(all_msgs) else all_msgs
            context_msgs = all_msgs[n:n + 5] if n < len(all_msgs) else []

            # Search for related context across other data sources
            related = self._find_related_context(conv.name, context_sources)

            entry = {
                "filename": file_path.name,
                "chat_name": conv.name,
                "type": conv.type,
                "unread_count": conv.unread_count,
                "unread_messages": unread_msgs,
                "context_messages": context_msgs,
            }
            if related:
                entry["related_context"] = related

            summaries.append(entry)

        summary_path = self.obsidian.vault_path / ".inbox-unread.json"
        summary_path.write_text(json.dumps({
            "conversations": summaries,
            "generated": datetime.now(UTC).isoformat(),
        }, indent=2, ensure_ascii=False))
        console.print(f"[dim]Wrote unread summary: {len(summaries)} conversations[/dim]")

    def _load_context_sources(self, vault: Path) -> dict[str, list[tuple[str, str]]]:
        """Load context sources for cross-referencing.

        Returns dict with source name -> list of (label, content) tuples.
        """
        sources: dict[str, list[tuple[str, str]]] = {}
        inbox = vault / "1 - Inbox (Last 7 days)"

        # Granola call summaries (not transcripts — smaller and more useful)
        granola_dir = inbox / "Granola" / "Summaries"
        if granola_dir.exists():
            entries = []
            for f in sorted(granola_dir.glob("*.md"), reverse=True)[:60]:
                # Prepend filename so name-based matches work (e.g. "alice" in "alice-bob-sync")
                text = f"{f.stem}\n\n{f.read_text()[:3000]}"
                entries.append((f.stem, text))
            sources["granola"] = entries

        # Gmail (last 7 days)
        gmail_dir = inbox / "Gmail"
        if gmail_dir.exists():
            entries = []
            for f in sorted(gmail_dir.glob("*.md"), reverse=True)[:7]:
                text = f.read_text()[:2000]
                entries.append((f.stem, text))
            sources["gmail"] = entries

        # Slack channels (last 7 days)
        slack_dir = inbox / "Slack" / "Channels"
        if slack_dir.exists():
            entries = []
            for f in sorted(slack_dir.glob("*.md"), reverse=True)[:14]:
                text = f.read_text()[:2000]
                entries.append((f.stem, text))
            sources["slack"] = entries

        # Today's brief and todo
        today_str = datetime.now(UTC).strftime("%Y-%m-%d")
        for name, subdir in [("brief", "0 - Daily Briefs"), ("todo", "3 - Todos")]:
            f = vault / subdir / f"{today_str}.md"
            if f.exists():
                sources[name] = [(today_str, f.read_text()[:3000])]

        return sources

    def _find_related_context(self, chat_name: str, sources: dict[str, list[tuple[str, str]]]) -> list[dict]:
        """Search for mentions of a person/chat across context sources.

        Returns list of {source, label, snippet} dicts.
        """
        import re

        # Build search terms from chat name
        # "Alice, Bob and Чарли" -> ["Alice", "Bob", "Чарли"]
        # "charlie | slow response" -> ["charlie"]
        # "CompanyA <> CompanyB (M&A)" -> ["CompanyA", "CompanyB"]
        raw_parts = re.split(r'[,<>&|/()]+', chat_name)
        search_terms = []
        for part in raw_parts:
            cleaned = part.strip().rstrip(".")
            # Skip noise words and short fragments
            if len(cleaned) >= 3 and cleaned.lower() not in {"and", "the", "for", "slow", "response", "m&a", "ooo"}:
                search_terms.append(cleaned)

        if not search_terms:
            return []

        related = []
        for source_name, entries in sources.items():
            for label, content in entries:
                content_lower = content.lower()
                for term in search_terms:
                    if term.lower() in content_lower:
                        # Extract a snippet around the match (±200 chars)
                        idx = content_lower.index(term.lower())
                        start = max(0, idx - 200)
                        end = min(len(content), idx + len(term) + 200)
                        snippet = content[start:end].strip()
                        if start > 0:
                            snippet = "..." + snippet
                        if end < len(content):
                            snippet = snippet + "..."
                        related.append({
                            "source": source_name,
                            "label": label,
                            "matched_term": term,
                            "snippet": snippet,
                        })
                        break  # one match per entry is enough

        # Dedupe and cap at 5 most relevant
        return related[:5]

    async def sync(self) -> dict[str, int]:
        """Sync conversations based on config settings.

        Returns:
            Dict mapping conversation names to number of new messages synced.
        """
        console.print("[bold]Starting Telegram sync...[/bold]")

        checkpoints = self._load_checkpoint()
        results: dict[str, int] = {}

        # Load CRM for entity lookup
        crm = None
        try:
            crm = load_crm()
            console.print(f"[dim]Loaded CRM with {len(crm.get('contacts', []))} contacts[/dim]")
        except Exception as e:
            console.print(f"[yellow]Warning: Could not load CRM: {e}[/yellow]")

        # Build conversation list: whitelist + optionally unread
        conversations: list[Conversation] = []
        seen_ids: set[int] = set()

        # Fetch all dialogs once to get real unread_count for whitelisted conversations
        all_dialogs = await self.telegram.get_conversations()
        dialog_map = {c.id: c for c in all_dialogs}

        # 1. Always sync whitelisted conversations
        selected = self.config.conversations.selected
        if selected:
            for conv_info in selected:
                dialog = dialog_map.get(conv_info["id"])
                conv = Conversation(
                    id=conv_info["id"],
                    name=conv_info["name"],
                    type=conv_info.get("type", "unknown"),
                    archived=conv_info.get("archived", False),
                    unread_count=dialog.unread_count if dialog else 0,
                )
                conversations.append(conv)
                seen_ids.add(conv.id)
            console.print(f"[dim]Whitelist: {len(selected)} conversations[/dim]")

        # 2. If enabled, also add unread conversations (excluding already in whitelist)
        discovered_ids: set[int] = set()
        if self.config.sync.sync_unread_only:
            unread = [c for c in all_dialogs if c.unread_count > 0]
            # Apply type filters
            filtered_unread = []
            for c in unread:
                if c.archived and not self.config.sync.include_archived:
                    continue
                if c.type == "private" and not self.config.sync.include_dms:
                    continue
                if c.type == "group" and not self.config.sync.include_groups:
                    continue
                if c.type == "channel" and not self.config.sync.include_channels:
                    continue
                filtered_unread.append(c)
            new_unread = [c for c in filtered_unread if c.id not in seen_ids]
            discovered_ids = {c.id for c in new_unread}
            conversations.extend(new_unread)
            console.print(f"[dim]Unread discovery: +{len(new_unread)} conversations[/dim]")

            # Auto-add discovered unread conversations to whitelist
            for conv in new_unread:
                add_to_whitelist(
                    str(self.config.base_path / "config.yaml"),
                    {"id": conv.id, "name": conv.name, "type": conv.type},
                )

        if not conversations:
            console.print("[yellow]No conversations to sync. Select some or enable unread discovery.[/yellow]")
            return results

        console.print(f"Syncing {len(conversations)} total conversations (2 concurrent)...")

        async def sync_single(conv: Conversation) -> tuple:
            """Sync one conversation with semaphore for rate limiting."""
            async with self._semaphore:
                matched_contact, match_confidence = None, None
                if crm:
                    matched_contact, match_confidence, _, _ = find_contact(crm, name=conv.name)
                    if not (matched_contact and match_confidence >= 0.6):
                        matched_contact, match_confidence = None, None

                try:
                    context_count = 5 if conv.id in discovered_ids else 0
                    count = await self._sync_conversation(conv, checkpoints, matched_contact, match_confidence, context_count=context_count)
                    # Save checkpoint after each conversation (not just at the end)
                    async with self._checkpoint_lock:
                        self._save_checkpoint(checkpoints)
                    if count > 0 and self.config.sync.mark_unread_after_sync:
                        try:
                            await self.telegram.mark_dialog_unread(conv.id)
                        except Exception:
                            pass
                    return (conv.name, count)
                except Exception as e:
                    return (conv.name, -1, str(e))

        # Run all syncs in parallel (semaphore limits to 2 concurrent)
        tasks = [sync_single(conv) for conv in conversations]
        results_list = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        for result in results_list:
            if isinstance(result, Exception):
                console.print(f"  [red]✗[/red] Error: {result}")
            elif len(result) == 3:
                name, count, error = result
                console.print(f"  [red]✗[/red] {name}: {error}")
                results[name] = -1
            else:
                name, count = result
                results[name] = count
                if count > 0:
                    console.print(f"  [green]✓[/green] {name}: {count} new messages")
                else:
                    console.print(f"  [dim]- {name}: up to date[/dim]")

        # Save updated checkpoints
        self._save_checkpoint(checkpoints)

        # Expand whitelist: add newly discovered unread conversations
        # Never remove — the whitelist is user-curated via the UI
        config_path = str(self.config.base_path / "config.yaml")
        existing_ids = {c["id"] for c in self.config.conversations.whitelist}
        new_entries = [
            {"id": c.id, "name": c.name, "type": c.type}
            for c in conversations
            if c.unread_count > 0 and c.id not in existing_ids
        ]
        if new_entries:
            expanded = list(self.config.conversations.whitelist) + new_entries
            save_whitelist(config_path, expanded)
            console.print(f"[dim]Whitelist expanded: +{len(new_entries)} new conversations[/dim]")

        # Write unread summary for AI suggestions (avoids reading all 64+ files)
        self._write_unread_summary(conversations)

        total = sum(c for c in results.values() if c > 0)
        console.print(f"\n[bold]Sync complete:[/bold] {total} new messages")

        return results

    async def _sync_conversation(
        self,
        conv: Conversation,
        checkpoints: dict[str, ConversationCheckpoint],
        matched_contact: dict | None = None,
        match_confidence: float | None = None,
        context_count: int = 0,
    ) -> int:
        """Sync a single conversation.

        Args:
            context_count: For discovered (non-whitelisted) conversations, fetch this many
                extra messages before the checkpoint for context. Already-written messages
                are deduplicated by ObsidianWriter.

        Returns:
            Number of new messages synced.
        """
        conv_id_str = str(conv.id)
        checkpoint = checkpoints.get(conv_id_str)

        # Fetch messages - use min_id for incremental sync (reliable)
        if checkpoint:
            # Incremental sync: get messages with ID > checkpoint
            messages = await self.telegram.get_messages(
                conv.id,
                min_id=checkpoint.latest_message_id,
                limit=500,
            )

            # For discovered conversations, also fetch context messages before checkpoint
            if context_count > 0:
                context_msgs = await self.telegram.get_messages(
                    conv.id,
                    max_id=checkpoint.latest_message_id + 1,
                    limit=context_count,
                )
                # Merge: context + new, deduplicated by ID
                seen = {m.id for m in messages}
                for m in context_msgs:
                    if m.id not in seen:
                        messages.append(m)
                messages.sort(key=lambda m: m.id)
        else:
            # First sync: fetch all recent messages and filter by date
            # Don't use offset_date - it's unreliable for "since" semantics
            cutoff = datetime.now(UTC) - timedelta(days=self.config.sync.initial_lookback_days)
            all_messages = await self.telegram.get_messages(
                conv.id,
                limit=500,
            )
            # Filter to only messages within lookback period
            messages = [m for m in all_messages if m.date >= cutoff]

        if not messages:
            # No messages at all, but still update frontmatter (e.g. unread_count)
            if checkpoint:
                self.obsidian.update_frontmatter(
                    conversation_name=conv.name,
                    conversation_type=conv.type,
                    archived=conv.archived,
                    unread_count=conv.unread_count,
                )
            return 0

        # Update conversation name in messages
        for msg in messages:
            msg.conversation_name = conv.name

        # Filter out messages we've already seen
        if checkpoint:
            messages = [m for m in messages if m.id > checkpoint.latest_message_id]

        if not messages:
            # No new messages, but still update frontmatter (e.g. unread_count)
            self.obsidian.update_frontmatter(
                conversation_name=conv.name,
                conversation_type=conv.type,
                archived=conv.archived,
                unread_count=conv.unread_count,
            )
            return 0

        # Write to Obsidian
        self.obsidian.write_messages(
            conversation_name=conv.name,
            conversation_id=conv.id,
            conversation_type=conv.type,
            messages=messages,
            append=checkpoint is not None,
            archived=conv.archived,
            matched_contact_id=matched_contact.get("id") if matched_contact else None,
            matched_contact_name=matched_contact.get("name") if matched_contact else None,
            match_confidence=match_confidence,
            unread_count=conv.unread_count,
        )

        # Update checkpoint (with lock for thread safety in parallel sync)
        latest = max(messages, key=lambda m: m.id)
        async with self._checkpoint_lock:
            checkpoints[conv_id_str] = ConversationCheckpoint(
                latest_message_id=latest.id,
                latest_timestamp=latest.date.timestamp(),
                name=conv.name,
            )

        return len(messages)

    async def sync_single(self, conversation_name: str) -> int:
        """Sync a single conversation by name.

        Returns:
            Number of new messages synced.
        """
        # Find conversation in selected list
        selected = self.config.conversations.selected
        conv_info = None

        for c in selected:
            if conversation_name.lower() in c["name"].lower():
                conv_info = c
                break

        if not conv_info:
            console.print(f"[red]Conversation '{conversation_name}' not in selected list.[/red]")
            return -1

        conv = Conversation(
            id=conv_info["id"],
            name=conv_info["name"],
            type=conv_info.get("type", "unknown"),
            archived=conv_info.get("archived", False),
        )

        checkpoints = self._load_checkpoint()
        count = await self._sync_conversation(conv, checkpoints)
        self._save_checkpoint(checkpoints)

        return count

    async def discover_new_chats(self, config_path: str = "config.yaml") -> dict[str, list[dict]]:
        """Discover new chats and handle according to discovery config.

        Returns:
            Dict with 'auto_added' and 'pending' lists of new conversations.
        """
        if not self.config.discovery.enabled:
            console.print("[dim]Discovery disabled in config[/dim]")
            return {"auto_added": [], "pending": []}

        console.print("[bold]Discovering new chats...[/bold]")

        # Get all dialogs from Telegram
        all_dialogs = await self.telegram.get_conversations()

        # Get known conversation IDs
        whitelist_ids = {c["id"] for c in self.config.conversations.whitelist}
        ignored_ids = {c["id"] for c in self.config.conversations.ignored}
        pending_ids = {c["id"] for c in self.config.conversations.pending}
        known_ids = whitelist_ids | ignored_ids | pending_ids

        # Find new conversations
        new_conversations = [conv for conv in all_dialogs if conv.id not in known_ids]

        if not new_conversations:
            console.print("[dim]No new chats found[/dim]")
            return {"auto_added": [], "pending": []}

        console.print(f"Found {len(new_conversations)} new chats")

        auto_added = []
        pending = []

        for conv in new_conversations:
            conv_dict = {
                "id": conv.id,
                "name": conv.name,
                "type": conv.type,
            }

            # Determine action based on type and config
            should_auto_add = False

            if conv.type == "group" and self.config.discovery.auto_add_groups:
                should_auto_add = True
            elif conv.type == "private" and self.config.discovery.auto_add_dms:
                should_auto_add = True
            elif conv.type == "channel" and self.config.discovery.auto_add_channels:
                should_auto_add = True

            if should_auto_add:
                add_to_whitelist(config_path, conv_dict)
                auto_added.append(conv_dict)
                console.print(f"  [green]+ Auto-added:[/green] {conv.name} ({conv.type})")
            else:
                add_to_pending(config_path, conv_dict)
                pending.append(conv_dict)
                console.print(f"  [yellow]? Pending:[/yellow] {conv.name} ({conv.type})")

        # Reload config to reflect changes
        # (Config object itself won't update, but files are updated)

        return {"auto_added": auto_added, "pending": pending}
