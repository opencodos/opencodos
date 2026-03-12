"""Telegram client wrapper using Telethon."""

import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import assemblyai as aai
import qrcode
from rich.console import Console
from telethon import TelegramClient as TelethonClient
from telethon.errors.common import TypeNotFoundError
from telethon.sessions.string import StringSession
from telethon.tl.custom import Dialog, Message  # type: ignore[reportPrivateImportUsage]
from telethon.tl.functions.messages import GetDialogFiltersRequest
from telethon.tl.types import (
    Channel,
    Chat,
    DocumentAttributeAudio,
    MessageActionPhoneCall,
    PhoneCallDiscardReasonBusy,
    PhoneCallDiscardReasonDisconnect,
    PhoneCallDiscardReasonHangup,
    PhoneCallDiscardReasonMissed,
    User,
)

from backend.codos_adapters.telethon import client as telethon_client
from backend.codos_adapters.telethon.session import save_session_string
from backend.codos_utils.secrets import get_secrets_backend
from backend.codos_utils.telegram import TELEGRAM_CHANNEL_ID_OFFSET

console = Console()

DEVICE_MODEL = "Codos"
APP_VERSION = os.environ.get("CODOS_VERSION", "unknown")


@dataclass
class TelegramMessage:
    id: int
    date: datetime
    sender_name: str
    text: str
    conversation_id: int
    conversation_name: str
    reply_to_text: str | None = None
    reply_to_sender: str | None = None


@dataclass
class Conversation:
    id: int
    name: str
    type: str  # "private", "group", "channel"
    archived: bool = False
    folder_id: int | None = None
    folder_name: str | None = None
    unread_count: int = 0


@dataclass
class TelegramFolder:
    id: int
    title: str
    conversations: list[Conversation] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.conversations)


def transcribe_voice(voice_path: str) -> str:
    """Transcribe voice message using AssemblyAI."""
    api_key = os.getenv("ASSEMBLYAI_API_KEY")
    if not api_key:
        return "[Voice - transcription not configured]"

    try:
        aai.settings.api_key = api_key
        config = aai.TranscriptionConfig(language_detection=True, punctuate=True, format_text=True)
        transcriber = aai.Transcriber()
        transcript = transcriber.transcribe(voice_path, config=config)

        if transcript.status == aai.TranscriptStatus.error:
            return f"[Voice - transcription error: {transcript.error}]"

        return transcript.text or "[Voice - could not transcribe]"
    except Exception as e:
        return f"[Voice - transcription failed: {e}]"


class TelegramClientWrapper:
    """Wrapper around Telethon for simplified operations."""

    SESSION_FILE = "session.string"

    def __init__(self, api_id: int, api_hash: str, base_path: Path):
        self.api_id = api_id
        self.api_hash = api_hash
        self.base_path = base_path
        self.session_path = base_path / self.SESSION_FILE
        self._client: TelethonClient | None = None
        self._folders_cache: dict[int, str] = {}

    def _load_session(self) -> str:
        """Load session string from file."""
        if self.session_path.exists():
            return self.session_path.read_text().strip()
        return ""

    def _save_session(self, session_string: str) -> None:
        """Save session string to file and secrets backend."""
        # Save to local file
        self.session_path.write_text(session_string)
        console.print(f"[green]Session saved to {self.session_path}[/green]")

        # Also persist to secrets backend (single source of truth for MCP)
        get_secrets_backend().set("TELEGRAM_SESSION_STRING", session_string)
        console.print("[green]Session synced to secrets backend[/green]")

    async def connect(self) -> None:
        """Connect to Telegram using saved session."""
        session_string = self._load_session()
        if not session_string:
            raise RuntimeError("No session found. Run 'python agent.py login' first.")

        self._client = TelethonClient(
            StringSession(session_string),
            self.api_id,
            self.api_hash,
            device_model=DEVICE_MODEL,
            app_version=APP_VERSION,
        )
        await telethon_client.connect(self._client)

        if not await self._client.is_user_authorized():
            raise RuntimeError("Session expired. Run 'python agent.py login' again.")

    async def disconnect(self) -> None:
        """Disconnect from Telegram."""
        if self._client:
            await telethon_client.disconnect(self._client)
            self._client = None

    async def login_with_qr(self) -> None:
        """Perform QR code login flow."""
        self._client = TelethonClient(
            StringSession(),
            self.api_id,
            self.api_hash,
            device_model=DEVICE_MODEL,
            app_version=APP_VERSION,
        )
        await telethon_client.connect(self._client)

        console.print("[bold]Telegram QR Login[/bold]")
        console.print("Scan the QR code with your Telegram app:\n")
        console.print("Telegram > Settings > Devices > Link Desktop Device\n")

        qr_login = await self._client.qr_login()

        # Display QR code in terminal
        self._display_qr(qr_login.url)

        console.print("\n[yellow]Waiting for QR scan...[/yellow]")

        try:
            # Wait for user to scan (with timeout handling)
            await qr_login.wait(timeout=120)

            # Get the session string
            self._save_session(save_session_string(self._client))

            # Get user info
            me = await self._client.get_me()
            if isinstance(me, User):
                console.print(f"\n[green]Logged in as: {me.first_name} (@{me.username})[/green]")

        except TimeoutError:
            console.print("[red]QR code expired. Please try again.[/red]")
            raise
        except Exception as e:
            # Handle 2FA if needed
            if "Two-steps verification" in str(e) or "password" in str(e).lower():
                console.print("\n[yellow]Two-factor authentication required.[/yellow]")
                password = console.input("[bold]Enter your 2FA password: [/bold]")
                await self._client.sign_in(password=password)

                self._save_session(save_session_string(self._client))

                me = await self._client.get_me()
                if isinstance(me, User):
                    console.print(f"\n[green]Logged in as: {me.first_name} (@{me.username})[/green]")
            else:
                raise

        await telethon_client.disconnect(self._client)

    def _display_qr(self, url: str) -> None:
        """Display QR code in terminal."""
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,  # type: ignore[reportAttributeAccessIssue]
            box_size=1,
            border=1,
        )
        qr.add_data(url)
        qr.make(fit=True)

        # Print QR code using Unicode blocks
        qr.print_ascii(invert=True)

    async def get_folder_metadata(self) -> list[TelegramFolder]:
        """Get folder metadata without fetching conversations (fast)."""
        if not self._client:
            raise RuntimeError("Not connected")

        folders: list[TelegramFolder] = []

        # Get dialog filters (folders) - this is fast
        result = await self._client(GetDialogFiltersRequest())

        for f in result.filters:
            if hasattr(f, "id") and hasattr(f, "title"):
                # Extract title text (may be TextWithEntities or string)
                title = f.title
                if hasattr(title, "text"):
                    title = title.text
                elif not isinstance(title, str):
                    title = str(title)

                # Estimate count from include_peers
                include_peers = getattr(f, "include_peers", [])
                folders.append(
                    TelegramFolder(
                        id=f.id,
                        title=title,
                        conversations=[Conversation(id=0, name="", type="private")] * len(include_peers),
                    )
                )
                self._folders_cache[f.id] = title

        return folders

    async def get_folders(self) -> list[TelegramFolder]:
        """Get all Telegram folders with their conversations (slow - fetches all dialogs)."""
        if not self._client:
            raise RuntimeError("Not connected")

        folders: list[TelegramFolder] = []

        # Get dialog filters (folders)
        result = await self._client(GetDialogFiltersRequest())

        # Build folder ID to name mapping
        folder_map: dict[int, str] = {0: "All Chats"}
        for f in result.filters:
            if hasattr(f, "id") and hasattr(f, "title"):
                folder_map[f.id] = f.title
                self._folders_cache[f.id] = f.title

        # Get all dialogs with their folder assignments
        dialogs = await self._client.get_dialogs()

        # Group conversations by type first (for "All Chats" view)
        private_chats: list[Conversation] = []
        groups: list[Conversation] = []
        channels: list[Conversation] = []

        for dialog in dialogs:
            conv = Conversation(
                id=dialog.id,
                name=dialog.name or f"Chat {dialog.id}",
                type=self._get_dialog_type(dialog),
                unread_count=dialog.unread_count,
            )

            if conv.type == "private":
                private_chats.append(conv)
            elif conv.type == "group":
                groups.append(conv)
            elif conv.type == "channel":
                channels.append(conv)

        # Create "All Chats" folder with type-based organization
        all_chats = TelegramFolder(id=0, title="All Chats")
        all_chats.conversations = private_chats + groups + channels
        folders.append(all_chats)

        # Add type-based pseudo-folders
        if private_chats:
            folders.append(TelegramFolder(id=-1, title="Private Chats", conversations=private_chats))
        if groups:
            folders.append(TelegramFolder(id=-2, title="Groups", conversations=groups))
        if channels:
            folders.append(TelegramFolder(id=-3, title="Channels", conversations=channels))

        # Add user-defined folders
        for f in result.filters:
            if not hasattr(f, "id") or not hasattr(f, "title"):
                continue

            folder_convs = []
            include_peers = getattr(f, "include_peers", [])

            for peer in include_peers:
                peer_id = None
                if hasattr(peer, "user_id"):
                    peer_id = peer.user_id
                elif hasattr(peer, "channel_id"):
                    peer_id = TELEGRAM_CHANNEL_ID_OFFSET - peer.channel_id
                elif hasattr(peer, "chat_id"):
                    peer_id = -peer.chat_id

                if peer_id:
                    # Find matching dialog
                    for dialog in dialogs:
                        if dialog.id == peer_id:
                            folder_convs.append(
                                Conversation(
                                    id=dialog.id,
                                    name=dialog.name or f"Chat {dialog.id}",
                                    type=self._get_dialog_type(dialog),
                                    folder_id=f.id,
                                    folder_name=f.title,
                                    unread_count=dialog.unread_count,
                                )
                            )
                            break

            if folder_convs:
                folders.append(
                    TelegramFolder(
                        id=f.id,
                        title=f.title,
                        conversations=folder_convs,
                    )
                )

        return folders

    async def get_conversations(
        self,
        limit: int | None = None,
        folder_id: int | None = None,
    ) -> list[Conversation]:
        """Get conversations/dialogs, optionally filtered by folder.

        Args:
            limit: Max number of conversations to return (None = all)
            folder_id: Filter by folder ID. Special values:
                       0 = All Chats (no filter)
                       -1 = Private chats only
                       -2 = Groups only
                       -3 = Channels only
                       >0 = User-defined folder
        """
        if not self._client:
            raise RuntimeError("Not connected")

        # For user-defined folders, get the folder's include_peers and filter
        if folder_id is not None and folder_id > 0:
            return await self._get_folder_conversations(folder_id, limit)

        conversations = []
        dialogs_iter = self._client.iter_dialogs(limit=limit)  # type: ignore[arg-type]

        while True:
            try:
                dialog = await dialogs_iter.__anext__()
            except StopAsyncIteration:
                break
            except TypeNotFoundError as e:
                # Skip dialogs with unrecognized Telegram types (Telethon outdated)
                console.print(f"[dim]Skipping dialog with unrecognized type: {e}[/dim]")
                continue
            except Exception as e:
                # Connection-level failures can loop forever if we keep continuing.
                msg = str(e).lower()
                if "disconnected" in msg or "connection" in msg:
                    raise RuntimeError(f"Telegram client disconnected while listing dialogs: {e}") from e
                # For per-dialog issues, continue iterating.
                console.print(f"[yellow]Warning: Error iterating dialog: {e}[/yellow]")
                continue

            try:
                conv_type = self._get_dialog_type(dialog)

                # Apply type-based filter for pseudo-folders
                if folder_id == -1 and conv_type != "private":
                    continue
                elif folder_id == -2 and conv_type != "group":
                    continue
                elif folder_id == -3 and conv_type != "channel":
                    continue

                conversations.append(
                    Conversation(
                        id=dialog.id,
                        name=dialog.name or f"Chat {dialog.id}",
                        type=conv_type,
                        archived=dialog.archived or dialog.folder_id == 1,
                        folder_id=dialog.folder_id,
                        unread_count=dialog.unread_count,
                    )
                )
            except Exception as e:
                # Skip dialogs that fail to process but continue
                console.print(f"[yellow]Warning: Error processing dialog: {e}[/yellow]")
                continue

        return conversations

    async def get_unread_conversations(
        self,
        include_muted: bool = False,
        include_archived: bool = False,
        include_groups: bool = True,
        include_channels: bool = False,
        include_dms: bool = True,
    ) -> list[Conversation]:
        """Get only conversations with unread messages, filtered by type."""
        all_convs = await self.get_conversations()

        result = []
        for c in all_convs:
            # Must have unread messages
            if c.unread_count <= 0:
                continue

            # Filter archived
            if not include_archived and c.archived:
                continue

            # Filter by type
            if c.type == "private" and not include_dms:
                continue
            if c.type == "group" and not include_groups:
                continue
            if c.type == "channel" and not include_channels:
                continue

            result.append(c)

        return result

    async def _get_folder_conversations(
        self,
        folder_id: int,
        limit: int | None = None,
    ) -> list[Conversation]:
        """Get conversations for a specific user-defined folder (fast)."""
        if not self._client:
            raise RuntimeError("Not connected")

        # Get dialog filters to find the target folder
        result = await self._client(GetDialogFiltersRequest())

        target_filter = None
        for f in result.filters:
            if hasattr(f, "id") and f.id == folder_id:
                target_filter = f
                break

        if not target_filter:
            return []

        # Get peers from the folder's include_peers
        include_peers = getattr(target_filter, "include_peers", [])
        if not include_peers:
            return []

        # Fetch entities for each peer directly
        conversations: list[Conversation] = []
        for peer in include_peers:
            if limit and len(conversations) >= limit:
                break

            try:
                entity = await self._client.get_entity(peer)

                # get_entity can return a list; we only handle single entities
                if isinstance(entity, list):
                    continue

                # Determine type
                if isinstance(entity, Channel):
                    if entity.megagroup:
                        conv_type = "group"
                    elif entity.broadcast:
                        conv_type = "channel"
                    else:
                        conv_type = "group"
                elif isinstance(entity, User):
                    conv_type = "private"
                elif isinstance(entity, Chat):
                    conv_type = "group"
                else:
                    conv_type = "group"

                # Get name
                if isinstance(entity, (Channel, Chat)):
                    name = entity.title or f"Chat {entity.id}"
                elif isinstance(entity, User):
                    parts = [entity.first_name or "", entity.last_name or ""]
                    name = " ".join(p for p in parts if p).strip() or f"User {entity.id}"
                else:
                    name = f"Chat {entity.id}"

                # Get dialog ID (negative for channels/groups)
                if conv_type in ("group", "channel"):
                    dialog_id = TELEGRAM_CHANNEL_ID_OFFSET - entity.id
                else:
                    dialog_id = entity.id

                conversations.append(
                    Conversation(
                        id=dialog_id,
                        name=name,
                        type=conv_type,
                        folder_id=folder_id,
                        unread_count=0,
                    )
                )
            except Exception:
                # Skip peers we can't resolve
                continue

        return conversations

    def _get_dialog_type(self, dialog: Dialog) -> str:
        """Determine dialog type."""
        if dialog.is_user:
            return "private"
        elif dialog.is_group:
            return "group"
        elif dialog.is_channel:
            return "channel"
        return "unknown"

    async def get_messages(
        self,
        conversation_id: int,
        since: datetime | None = None,
        limit: int = 100,
        min_id: int | None = None,
        max_id: int | None = None,
    ) -> list[TelegramMessage]:
        """Get messages from a conversation.

        Args:
            conversation_id: Telegram chat ID
            since: Deprecated - use min_id instead. Date to filter messages (unreliable).
            limit: Max messages to fetch
            min_id: Only fetch messages with ID > min_id (reliable for incremental sync)
            max_id: Only fetch messages with ID < max_id (for context lookback)
        """
        if not self._client:
            raise RuntimeError("Not connected")

        messages = []
        reply_map: dict[int, int] = {}  # msg_id -> reply_to_msg_id

        # Use min_id for reliable incremental sync, fall back to offset_date for compatibility
        iter_kwargs: dict[str, object] = {
            "entity": conversation_id,
            "limit": limit,
        }

        if min_id is not None:
            # Fetch messages with ID > min_id (newest first, then we reverse)
            iter_kwargs["min_id"] = min_id
        if max_id is not None:
            # Fetch messages with ID < max_id (for context lookback)
            iter_kwargs["max_id"] = max_id
        if min_id is None and max_id is None and since is not None:
            # Legacy: offset_date gets messages BEFORE this date, not after
            # This is kept for backwards compatibility but is unreliable
            iter_kwargs["offset_date"] = since
            iter_kwargs["reverse"] = True

        async for msg in self._client.iter_messages(**iter_kwargs):  # type: ignore[arg-type]
            # Handle phone call actions
            if hasattr(msg, "action") and isinstance(msg.action, MessageActionPhoneCall):
                text = self._format_call_action(msg.action)
                sender_name = await self._get_sender_name(msg)
                messages.append(
                    TelegramMessage(
                        id=msg.id,
                        date=msg.date.replace(tzinfo=UTC) if msg.date else datetime.now(UTC),
                        sender_name=sender_name,
                        text=text,
                        conversation_id=conversation_id,
                        conversation_name="",
                    )
                )
                continue

            # Handle voice messages (recorded in Telegram)
            if hasattr(msg, "voice") and msg.voice:
                sender_name = await self._get_sender_name(msg)

                # Download voice to temp file
                with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                    tmp_path = tmp.name
                await self._client.download_media(msg.voice, tmp_path)
                transcript = transcribe_voice(tmp_path)
                os.unlink(tmp_path)  # Clean up

                # Extract duration from document attributes
                duration = 0
                if hasattr(msg.voice, "attributes"):
                    for attr in msg.voice.attributes:
                        if isinstance(attr, DocumentAttributeAudio):
                            duration = attr.duration or 0
                            break
                mins, secs = divmod(duration, 60)
                duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"

                text = f"🎤 [{duration_str}] {transcript}"

                messages.append(
                    TelegramMessage(
                        id=msg.id,
                        date=msg.date.replace(tzinfo=UTC) if msg.date else datetime.now(UTC),
                        sender_name=sender_name,
                        text=text,
                        conversation_id=conversation_id,
                        conversation_name="",
                    )
                )
                continue

            # Handle audio files (MP3s, podcasts, etc. - sent as documents)
            if hasattr(msg, "audio") and msg.audio:
                sender_name = await self._get_sender_name(msg)

                # Download audio to temp file for transcription
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                    tmp_path = tmp.name
                await self._client.download_media(msg.audio, tmp_path)
                transcript = transcribe_voice(tmp_path)
                os.unlink(tmp_path)  # Clean up

                # Extract duration
                duration = 0
                if hasattr(msg.audio, "attributes"):
                    for attr in msg.audio.attributes:
                        if isinstance(attr, DocumentAttributeAudio):
                            duration = attr.duration or 0
                            break
                mins, secs = divmod(duration, 60)
                duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"

                text = f"🎵 [{duration_str}] {transcript}"

                messages.append(
                    TelegramMessage(
                        id=msg.id,
                        date=msg.date.replace(tzinfo=UTC) if msg.date else datetime.now(UTC),
                        sender_name=sender_name,
                        text=text,
                        conversation_id=conversation_id,
                        conversation_name="",
                    )
                )
                continue

            # Handle video notes (circular videos)
            if hasattr(msg, "video_note") and msg.video_note:
                sender_name = await self._get_sender_name(msg)

                # Download video note for transcription
                with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                    tmp_path = tmp.name
                await self._client.download_media(msg.video_note, tmp_path)
                transcript = transcribe_voice(tmp_path)
                os.unlink(tmp_path)  # Clean up

                # Extract duration
                duration = getattr(msg.video_note, "duration", 0)
                mins, secs = divmod(duration, 60)
                duration_str = f"{mins}m {secs}s" if mins else f"{secs}s"

                text = f"🔵 Video [{duration_str}] {transcript}"

                messages.append(
                    TelegramMessage(
                        id=msg.id,
                        date=msg.date.replace(tzinfo=UTC) if msg.date else datetime.now(UTC),
                        sender_name=sender_name,
                        text=text,
                        conversation_id=conversation_id,
                        conversation_name="",
                    )
                )
                continue

            # Build text content - handle various message types
            text = msg.text or ""

            # Handle media-only messages (no text but has media)
            if not text:
                media_type = None
                if hasattr(msg, "photo") and msg.photo:
                    media_type = "📷 Photo"
                elif hasattr(msg, "video") and msg.video:
                    media_type = "🎥 Video"
                elif hasattr(msg, "sticker") and msg.sticker:
                    # Try to get sticker emoji
                    emoji = getattr(msg.sticker, "emoji", "") or ""
                    media_type = f"🎨 Sticker {emoji}".strip()
                elif hasattr(msg, "document") and msg.document:
                    media_type = "📎 File"
                elif hasattr(msg, "gif") and msg.gif:
                    media_type = "🎬 GIF"
                elif hasattr(msg, "poll") and msg.poll:
                    media_type = "📊 Poll"
                elif hasattr(msg, "contact") and msg.contact:
                    media_type = "👤 Contact"
                elif hasattr(msg, "geo") and msg.geo:
                    media_type = "📍 Location"

                if media_type:
                    text = media_type
                else:
                    # Skip truly empty messages (service messages, etc.)
                    continue

            sender_name = await self._get_sender_name(msg)

            # Track reply info
            reply_to_id = None
            if hasattr(msg, "reply_to") and msg.reply_to:
                reply_to_id = getattr(msg.reply_to, "reply_to_msg_id", None)

            messages.append(
                TelegramMessage(
                    id=msg.id,
                    date=msg.date.replace(tzinfo=UTC) if msg.date else datetime.now(UTC),
                    sender_name=sender_name,
                    text=text,
                    conversation_id=conversation_id,
                    conversation_name="",  # Filled in by caller
                )
            )

            if reply_to_id:
                reply_map[msg.id] = reply_to_id

        # Batch fetch reply originals and populate reply fields
        if reply_map:
            reply_ids = list(set(reply_map.values()))
            originals_result = await self._client.get_messages(conversation_id, ids=reply_ids)
            # get_messages with ids=list always returns a list at runtime
            originals: list[Message] = (
                originals_result  # type: ignore[assignment]
                if isinstance(originals_result, list)
                else [originals_result]  # type: ignore[list-item]
                if originals_result
                else []
            )

            # Build lookup: reply_id -> (sender, text_preview)
            original_lookup: dict[int, tuple[str, str]] = {}
            for orig in originals:
                if orig:
                    sender = await orig.get_sender()
                    if isinstance(sender, User):
                        name = sender.first_name or f"User {sender.id}"
                    elif isinstance(sender, (Channel, Chat)):
                        name = sender.title or f"Chat {sender.id}"
                    else:
                        name = "Unknown"
                    text_preview = (orig.text or "[media]")[:100]
                    original_lookup[orig.id] = (name, text_preview)

            # Populate reply fields on messages
            for m in messages:
                if m.id in reply_map:
                    orig_id = reply_map[m.id]
                    if orig_id in original_lookup:
                        m.reply_to_sender, m.reply_to_text = original_lookup[orig_id]
                    else:
                        m.reply_to_sender = None
                        m.reply_to_text = "[deleted message]"

        return messages

    async def _get_sender_name(self, msg: Message) -> str:
        """Get display name of message sender."""
        try:
            sender = await msg.get_sender()
            if isinstance(sender, User):
                parts = [sender.first_name or "", sender.last_name or ""]
                name = " ".join(p for p in parts if p).strip()
                if sender.username:
                    return f"{name} (@{sender.username})" if name else f"@{sender.username}"
                return name or f"User {sender.id}"
            elif isinstance(sender, (Channel, Chat)):
                return sender.title or f"Chat {sender.id}"
        except Exception:
            pass
        return "Unknown"

    def _format_call_action(self, action: MessageActionPhoneCall) -> str:
        """Format phone call action as readable text."""
        call_type = "📹 Video call" if action.video else "📞 Voice call"

        # If we have duration, call was completed
        if action.duration:
            mins, secs = divmod(action.duration, 60)
            if mins >= 60:
                hours, mins = divmod(mins, 60)
                duration = f"{hours}h {mins}m"
            elif mins:
                duration = f"{mins}m {secs}s"
            else:
                duration = f"{secs}s"
            return f"{call_type} ({duration})"

        # No duration means missed/declined/no answer
        reason = action.reason
        if reason is None:
            return f"{call_type} - No answer"
        elif isinstance(reason, PhoneCallDiscardReasonMissed):
            return f"{call_type} - Missed"
        elif isinstance(reason, PhoneCallDiscardReasonBusy):
            return f"{call_type} - Declined"
        elif isinstance(reason, PhoneCallDiscardReasonHangup):
            return f"{call_type} - Ended"
        elif isinstance(reason, PhoneCallDiscardReasonDisconnect):
            return f"{call_type} - Disconnected"
        else:
            return f"{call_type}"

    async def send_message(self, conversation_id: int, text: str, reply_to: int | None = None) -> None:
        """Send a message to a conversation."""
        if not self._client:
            raise RuntimeError("Not connected")

        try:
            if reply_to is not None:
                await self._client.send_message(conversation_id, text, reply_to=reply_to)
            else:
                await self._client.send_message(conversation_id, text)
        except ValueError:
            # Entity not in cache — resolve it first via get_dialogs, then retry
            await self._client.get_dialogs(limit=100)
            if reply_to is not None:
                await self._client.send_message(conversation_id, text, reply_to=reply_to)
            else:
                await self._client.send_message(conversation_id, text)

    async def mark_dialog_unread(self, conversation_id: int) -> None:
        """Mark a dialog as unread to preserve in Telegram app."""
        if not self._client:
            raise RuntimeError("Not connected")

        from telethon.tl.functions.messages import MarkDialogUnreadRequest
        from telethon.tl.types import InputDialogPeer

        input_entity = await self._client.get_input_entity(conversation_id)
        await self._client(MarkDialogUnreadRequest(peer=InputDialogPeer(peer=input_entity), unread=True))

    async def find_conversation_by_name(self, name: str) -> Conversation | None:
        """Find a conversation by name (case-insensitive partial match)."""
        conversations = await self.get_conversations()
        name_lower = name.lower()

        for conv in conversations:
            if name_lower in conv.name.lower():
                return conv

        return None
