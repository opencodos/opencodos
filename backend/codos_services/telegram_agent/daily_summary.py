#!/usr/bin/env python3
"""
Generate daily summary of Telegram messages.

This script has been refactored to use Claude Code instead of the Anthropic API.
The context gathering logic has been extracted to gather-telegram-summary-context.py.

Usage:
    python daily_summary.py              # Print instructions for Claude Code
    python daily_summary.py --context-only   # Output context to stdout (for piping)

For full summary generation, use:
    ./run-telegram-summary-cc.sh
"""

import argparse
import os

# Import context gathering functions from the new module
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from rich.console import Console

# Load gather module dynamically to avoid circular imports
gather_path = Path(__file__).parent / "gather-telegram-summary-context.py"
spec = spec_from_file_location("gather_telegram_summary_context", gather_path)
if not spec or not spec.loader:
    raise RuntimeError(f"Could not load module spec from {gather_path}")
gather_module = module_from_spec(spec)
spec.loader.exec_module(gather_module)

# Import functions from the gather module
gather_context = gather_module.gather_context
format_prompt = gather_module.format_prompt

console = Console()

# Paths from environment with defaults
VAULT_PATH = Path(os.environ.get("VAULT_PATH", ""))
TELEGRAM_FOLDER = VAULT_PATH / "1 - Inbox (Last 7 days)/Telegram"
SUMMARY_FOLDER = TELEGRAM_FOLDER / "Daily Summary"


def print_context_only():
    """Output context to stdout for piping to Claude Code."""
    context = gather_context(hours=24)
    prompt = format_prompt(context)
    print(prompt)


def print_usage_instructions():
    """Print instructions for using Claude Code to generate summary."""
    console.print("[bold]Telegram Daily Summary[/bold]")
    console.print("")
    console.print("This script has been migrated to use Claude Code instead of the Anthropic API.")
    console.print("")
    console.print("[yellow]To generate a summary, use one of these methods:[/yellow]")
    console.print("")
    console.print("1. [green]Recommended:[/green] Run the wrapper script:")
    console.print("   ./run-telegram-summary-cc.sh")
    console.print("")
    console.print("2. [green]Context only:[/green] Output context for manual processing:")
    console.print("   python daily_summary.py --context-only")
    console.print("")
    console.print("3. [green]Manual:[/green] Run gather script and pipe to Claude Code:")
    console.print("   python gather-telegram-summary-context.py > /tmp/context.md")
    console.print("   claude -p 'Analyze /tmp/context.md and write summary' --model opus")
    console.print("")

    # Show current stats
    console.print("[bold]Current message stats:[/bold]")
    context = gather_context(hours=24)
    console.print(f"  Total messages: {context['message_count']}")
    console.print(f"  High priority: {context['high_count']}")
    console.print(f"  Medium priority: {context['medium_count']}")
    console.print(f"  Low priority: {context['low_count']}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Generate Telegram daily summary using Claude Code")
    parser.add_argument(
        "--context-only", action="store_true", help="Output context to stdout for piping to Claude Code"
    )
    args = parser.parse_args()

    if args.context_only:
        print_context_only()
    else:
        print_usage_instructions()


if __name__ == "__main__":
    main()
