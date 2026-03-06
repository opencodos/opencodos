"""Terminal TUI for selecting Telegram conversations to sync."""

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.table import Table

from .telegram_client import Conversation, TelegramClientWrapper, TelegramFolder

console = Console()


class ConversationSelector:
    """Interactive TUI for selecting conversations to sync."""

    def __init__(self, telegram: TelegramClientWrapper):
        self.telegram = telegram
        self.folders: list[TelegramFolder] = []
        self.selected: set[int] = set()  # Set of selected conversation IDs
        self.all_conversations: dict[int, Conversation] = {}  # ID -> Conversation

    async def load_conversations(self, limit: int = 100) -> None:
        """Load conversations from Telegram."""
        console.print("[dim]Loading conversations...[/dim]")

        # Get folders with conversations
        self.folders = await self.telegram.get_folders()

        # Build lookup dict
        for folder in self.folders:
            for conv in folder.conversations:
                self.all_conversations[conv.id] = conv

        console.print(f"[green]Loaded {len(self.all_conversations)} conversations[/green]")

    def run_interactive(self) -> list[dict]:
        """Run interactive selection UI. Returns list of selected conversations."""
        while True:
            self._display_menu()
            choice = Prompt.ask("\n[bold]Action[/bold]", choices=["1", "2", "3", "4", "5", "6", "q"], default="1")

            if choice == "1":
                self._browse_folders()
            elif choice == "2":
                self._browse_by_type()
            elif choice == "3":
                self._search_conversations()
            elif choice == "4":
                self._view_selected()
            elif choice == "5":
                self._select_all()
            elif choice == "6" or choice == "q":
                if self._confirm_selection():
                    break

        return self._get_selected_list()

    def _display_menu(self) -> None:
        """Display main menu."""
        console.clear()
        console.print(
            Panel(
                "[bold blue]Telegram Conversation Selector[/bold blue]\n\n"
                f"Selected: [green]{len(self.selected)}[/green] conversations",
                title="Select Conversations to Sync",
            )
        )

        console.print("\n[bold]Options:[/bold]")
        console.print("  [1] Browse by folders")
        console.print("  [2] Browse by type (Private/Groups/Channels)")
        console.print("  [3] Search conversations")
        console.print("  [4] View selected")
        console.print("  [5] Select all")
        console.print("  [6] Done / Save selection")
        console.print("  [q] Quit")

    def _browse_folders(self) -> None:
        """Browse and select from folders."""
        # Show folder list
        console.print("\n[bold]Folders:[/bold]")

        # Filter to user-defined folders (positive IDs, excluding 0)
        user_folders = [f for f in self.folders if f.id > 0]

        if not user_folders:
            console.print("[dim]No custom folders found. Use 'Browse by type' instead.[/dim]")
            Prompt.ask("\nPress Enter to continue")
            return

        for i, folder in enumerate(user_folders, 1):
            selected_in_folder = sum(1 for c in folder.conversations if c.id in self.selected)
            console.print(f"  [{i}] {folder.title} ({selected_in_folder}/{len(folder.conversations)})")

        console.print("  [0] Back")

        choice = Prompt.ask("\n[bold]Select folder[/bold]", default="0")

        if choice == "0":
            return

        try:
            idx = int(choice) - 1
            if 0 <= idx < len(user_folders):
                self._browse_folder(user_folders[idx])
        except ValueError:
            pass

    def _browse_by_type(self) -> None:
        """Browse conversations by type."""
        # Find type-based folders
        type_folders = [f for f in self.folders if f.id < 0]

        console.print("\n[bold]Conversation Types:[/bold]")
        for i, folder in enumerate(type_folders, 1):
            selected_count = sum(1 for c in folder.conversations if c.id in self.selected)
            console.print(f"  [{i}] {folder.title} ({selected_count}/{len(folder.conversations)})")

        console.print("  [0] Back")

        choice = Prompt.ask("\n[bold]Select type[/bold]", default="0")

        if choice == "0":
            return

        try:
            idx = int(choice) - 1
            if 0 <= idx < len(type_folders):
                self._browse_folder(type_folders[idx])
        except ValueError:
            pass

    def _browse_folder(self, folder: TelegramFolder) -> None:
        """Browse conversations in a folder."""
        page = 0
        page_size = 20

        while True:
            console.clear()
            console.print(f"[bold]{folder.title}[/bold] - Page {page + 1}")
            console.print(f"Selected: [green]{len(self.selected)}[/green] total\n")

            start = page * page_size
            end = start + page_size
            page_convs = folder.conversations[start:end]

            table = Table(show_header=True, header_style="bold")
            table.add_column("#", width=4)
            table.add_column("", width=3)  # Checkbox
            table.add_column("Name", min_width=30)
            table.add_column("Type", width=10)
            table.add_column("Unread", width=8)

            for i, conv in enumerate(page_convs, start + 1):
                checkbox = "[green]✓[/green]" if conv.id in self.selected else "[ ]"
                unread = f"[yellow]{conv.unread_count}[/yellow]" if conv.unread_count > 0 else "-"
                table.add_row(str(i), checkbox, conv.name[:40], conv.type, unread)

            console.print(table)

            console.print("\n[bold]Commands:[/bold]")
            console.print("  [number]  Toggle selection")
            console.print("  [a]       Select all on this page")
            console.print("  [n]       Deselect all on this page")
            console.print("  [>]       Next page")
            console.print("  [<]       Previous page")
            console.print("  [q]       Back to menu")

            cmd = Prompt.ask("\n[bold]Command[/bold]", default="q")

            if cmd == "q":
                break
            elif cmd == ">":
                if end < len(folder.conversations):
                    page += 1
            elif cmd == "<":
                if page > 0:
                    page -= 1
            elif cmd == "a":
                for conv in page_convs:
                    self.selected.add(conv.id)
            elif cmd == "n":
                for conv in page_convs:
                    self.selected.discard(conv.id)
            else:
                try:
                    idx = int(cmd) - 1
                    if start <= idx < end:
                        conv = folder.conversations[idx]
                        if conv.id in self.selected:
                            self.selected.discard(conv.id)
                        else:
                            self.selected.add(conv.id)
                except ValueError:
                    pass

    def _search_conversations(self) -> None:
        """Search conversations by name."""
        query = Prompt.ask("\n[bold]Search[/bold]")
        if not query:
            return

        query_lower = query.lower()
        matches = [conv for conv in self.all_conversations.values() if query_lower in conv.name.lower()]

        if not matches:
            console.print("[dim]No matches found.[/dim]")
            Prompt.ask("\nPress Enter to continue")
            return

        console.print(f"\n[bold]Found {len(matches)} matches:[/bold]\n")

        table = Table(show_header=True, header_style="bold")
        table.add_column("#", width=4)
        table.add_column("", width=3)
        table.add_column("Name", min_width=30)
        table.add_column("Type", width=10)

        for i, conv in enumerate(matches[:20], 1):
            checkbox = "[green]✓[/green]" if conv.id in self.selected else "[ ]"
            table.add_row(str(i), checkbox, conv.name[:40], conv.type)

        console.print(table)

        if len(matches) > 20:
            console.print(f"[dim]...and {len(matches) - 20} more[/dim]")

        console.print("\n[bold]Commands:[/bold]")
        console.print("  [number]  Toggle selection")
        console.print("  [a]       Select all matches")
        console.print("  [q]       Back to menu")

        cmd = Prompt.ask("\n[bold]Command[/bold]", default="q")

        if cmd == "a":
            for conv in matches:
                self.selected.add(conv.id)
        elif cmd != "q":
            try:
                idx = int(cmd) - 1
                if 0 <= idx < len(matches[:20]):
                    conv = matches[idx]
                    if conv.id in self.selected:
                        self.selected.discard(conv.id)
                    else:
                        self.selected.add(conv.id)
            except ValueError:
                pass

    def _view_selected(self) -> None:
        """View currently selected conversations."""
        if not self.selected:
            console.print("\n[dim]No conversations selected yet.[/dim]")
            Prompt.ask("\nPress Enter to continue")
            return

        console.print(f"\n[bold]Selected Conversations ({len(self.selected)}):[/bold]\n")

        table = Table(show_header=True, header_style="bold")
        table.add_column("#", width=4)
        table.add_column("Name", min_width=30)
        table.add_column("Type", width=10)

        selected_convs = [self.all_conversations[cid] for cid in self.selected if cid in self.all_conversations]

        for i, conv in enumerate(selected_convs[:50], 1):
            table.add_row(str(i), conv.name[:40], conv.type)

        console.print(table)

        if len(selected_convs) > 50:
            console.print(f"[dim]...and {len(selected_convs) - 50} more[/dim]")

        console.print("\n[bold]Commands:[/bold]")
        console.print("  [number]  Remove from selection")
        console.print("  [c]       Clear all")
        console.print("  [q]       Back to menu")

        cmd = Prompt.ask("\n[bold]Command[/bold]", default="q")

        if cmd == "c":
            if Confirm.ask("Clear all selections?"):
                self.selected.clear()
        elif cmd != "q":
            try:
                idx = int(cmd) - 1
                if 0 <= idx < len(selected_convs[:50]):
                    self.selected.discard(selected_convs[idx].id)
            except ValueError:
                pass

    def _select_all(self) -> None:
        """Select all loaded conversations."""
        if Confirm.ask(f"Select all {len(self.all_conversations)} conversations?"):
            self.selected = set(self.all_conversations.keys())
            console.print(f"[green]Selected {len(self.selected)} conversations[/green]")
            Prompt.ask("\nPress Enter to continue")

    def _confirm_selection(self) -> bool:
        """Confirm and save selection."""
        if not self.selected:
            if Confirm.ask("No conversations selected. Exit anyway?"):
                return True
            return False

        console.print(f"\n[bold]Saving {len(self.selected)} selected conversations.[/bold]")
        return Confirm.ask("Confirm?")

    def _get_selected_list(self) -> list[dict]:
        """Get selected conversations as list of dicts for config."""
        result = []
        for cid in self.selected:
            if cid in self.all_conversations:
                conv = self.all_conversations[cid]
                result.append(
                    {
                        "id": conv.id,
                        "name": conv.name,
                        "type": conv.type,
                    }
                )
        return result


async def run_selector(telegram: TelegramClientWrapper) -> list[dict]:
    """Run the conversation selector and return selected conversations."""
    selector = ConversationSelector(telegram)
    await selector.load_conversations(limit=100)
    return selector.run_interactive()
