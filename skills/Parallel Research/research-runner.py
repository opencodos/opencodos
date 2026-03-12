#!/usr/bin/env python3
"""Research Runner - Orchestrates research from the Research List.

Reads Research List.md, picks the first unchecked item, classifies it,
and routes to the appropriate research method:
  - x.com/twitter.com URLs → Claude + Chrome browser (fast, ~5-8 min)
  - Everything else        → Parallel AI API (deep, ~15-25 min)

Designed to run as a cron job with no AI overhead for orchestration.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

VAULT_PATH = os.environ.get("VAULT_PATH", os.path.expanduser("~/projects/Vault"))
CODOS_PATH = os.environ.get("CODOS_PATH", os.path.expanduser("~/projects/codos"))
RESEARCH_LIST = Path(VAULT_PATH) / "3 - Todos" / "Research List.md"
RESEARCH_DIR = Path(VAULT_PATH) / "2 - Projects" / "Research"
LOG_DIR = Path(CODOS_PATH) / "dev" / "Logs" / "workflows" / "research"
SCRIPT_DIR = Path(__file__).parent.resolve()

# ---------------------------------------------------------------------------
# Parse Research List
# ---------------------------------------------------------------------------


def parse_research_list() -> list[dict]:
    """Parse Research List.md and return unchecked items."""
    if not RESEARCH_LIST.exists():
        print(f"Research list not found: {RESEARCH_LIST}")
        return []

    text = RESEARCH_LIST.read_text()
    items = []
    for line in text.splitlines():
        # Match tab-indented unchecked items (skip the parent "Research list" header)
        m = re.match(r"\t+- \[ \] (.+)", line)
        if m:
            items.append({"raw": line, "content": m.group(1).strip()})
    return items


def extract_url(content: str) -> str | None:
    """Extract the first URL from an item's content."""
    m = re.search(r"(https?://[^\s)]+)", content)
    return m.group(1) if m else None


def is_twitter_url(url: str) -> bool:
    """Check if URL is an X/Twitter link."""
    return bool(re.search(r"(x\.com|twitter\.com)/", url))


def make_slug(text: str) -> str:
    """Generate a filename slug from text."""
    # Strip URLs from text for cleaner slugs
    clean = re.sub(r"https?://\S+", "", text).strip()
    if not clean:
        # Fall back to domain + path from URL
        url = extract_url(text)
        if url:
            clean = re.sub(r"https?://(www\.)?", "", url).split("?")[0]
    slug = re.sub(r"[^\w\s-]", "", clean.lower())[:50].strip()
    return re.sub(r"[\s_]+", "-", slug).strip("-") or "research"


def output_path_for(item_content: str) -> Path:
    """Generate the output file path for a research item."""
    slug = make_slug(item_content)
    date = datetime.now().strftime("%Y-%m-%d")
    return RESEARCH_DIR / f"{date}-{slug}.md"


# ---------------------------------------------------------------------------
# Research Methods
# ---------------------------------------------------------------------------


def research_with_chrome(url: str, item_content: str, output: Path) -> bool:
    """Use Claude + Chrome to browse a Twitter/X URL and write research."""
    # Build a descriptive label from the item content (strip URL)
    label = re.sub(r"https?://\S+", "", item_content).strip()
    label = label.strip("- ") or "this tweet"

    prompt = f"""Visit this Twitter/X post: {url}

Read the tweet content carefully. If the tweet links to a repo, article, demo, or tool \
— follow the most important link (max 2 hops) and read that too.

Write a comprehensive research summary and save it to: {output}

The summary file should have this format:
---
query: {label} {url}
date: {datetime.now():%Y-%m-%d}
source: twitter-chrome
---

## Summary
[2-3 sentence overview of what this is about]

## Key Details
[Bullet points covering the technical substance]

## How It Applies to Atlas/Codos
[How this could be used in an AI agent OS — be specific and actionable]

## Actionable Takeaways
[Concrete next steps, things to try, or ideas to implement]

## Source
- Tweet: {url}
- [Any linked repos/articles you visited]

IMPORTANT: Save the file using the Write tool. Do not just output the content — write it to the path above."""

    return _run_claude(prompt, timeout=600, chrome=True, model="sonnet")


def research_with_parallel(query: str, output: Path) -> bool:
    """Use Parallel AI API for deep research."""
    # Import the research function from parallel-research.py
    sys.path.insert(0, str(SCRIPT_DIR))
    from importlib import import_module

    try:
        mod = import_module("parallel-research")
    except ImportError:
        # Fallback: run as subprocess
        return _run_parallel_subprocess(query, output)

    try:
        content = mod.research(query, processor="pro", timeout=2400)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            f"---\nquery: {query}\ndate: {datetime.now():%Y-%m-%d}\nsource: parallel-ai\n---\n\n{content}\n"
        )
        print(f"Saved: {output}")
        return True
    except SystemExit as e:
        print(f"Parallel AI failed: {e}")
        return False
    except Exception as e:
        print(f"Parallel AI error: {e}")
        return False


def _run_parallel_subprocess(query: str, output: Path) -> bool:
    """Fallback: run parallel-research.py as subprocess."""
    venv_python = SCRIPT_DIR / ".venv" / "bin" / "python"
    python = str(venv_python) if venv_python.exists() else sys.executable
    script = str(SCRIPT_DIR / "parallel-research.py")

    try:
        result = subprocess.run(
            [python, script, query, str(output)],
            timeout=2400,
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print(f"stderr: {result.stderr}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("Parallel research timed out (2400s)")
        return False


def _run_claude(prompt: str, timeout: int = 600, chrome: bool = False, model: str = "sonnet") -> bool:
    """Run claude -p with the given prompt."""
    import tempfile

    # Write prompt to temp file (avoids shell escaping issues)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(prompt)
        prompt_file = f.name

    try:
        cmd = f'cat "{prompt_file}" | claude -p --model {model} --dangerously-skip-permissions'
        if chrome:
            cmd += " --chrome"

        env = {**os.environ}
        # Unset ANTHROPIC_API_KEY so Claude uses its own auth
        env.pop("ANTHROPIC_API_KEY", None)

        result = subprocess.run(
            ["bash", "-c", cmd],
            timeout=timeout,
            capture_output=True,
            text=True,
            env=env,
        )
        print(result.stdout[:500] if result.stdout else "(no output)")
        if result.returncode != 0:
            print(f"Claude failed (code {result.returncode}): {result.stderr[:300]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print(f"Claude timed out ({timeout}s)")
        return False
    finally:
        Path(prompt_file).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Update Research List
# ---------------------------------------------------------------------------


def update_research_list(item_raw: str, output: Path) -> None:
    """Cross off item in Research List and add done note."""
    text = RESEARCH_LIST.read_text()

    # Extract the content part (after "- [ ] ")
    content_match = re.match(r"([\t ]*- \[ \] )(.+)", item_raw)
    if not content_match:
        print(f"Warning: could not parse item for update: {item_raw}")
        return

    prefix_ws = content_match.group(1).split("- [ ] ")[0]
    content = content_match.group(2).strip()
    relative_output = str(output).replace(str(VAULT_PATH) + "/", "Vault/")

    replacement = f"{prefix_ws}- [x] ~~{content}~~ ✓ DONE — see {relative_output}"
    updated = text.replace(item_raw, replacement)

    if updated != text:
        RESEARCH_LIST.write_text(updated)
        print("Updated Research List: crossed off item")
    else:
        print("Warning: could not find item in list to update")


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


def log_run(status: str, duration_ms: int, output_path: Path | None = None, error: str | None = None) -> None:
    """Append to runs.jsonl."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "id": "research-runner",
        "name": "RESEARCH",
        "status": status,
        "output_path": str(output_path) if output_path else None,
        "timestamp": datetime.now().isoformat(),
        "duration_ms": duration_ms,
    }
    if error:
        entry["error"] = error
    with open(LOG_DIR / "runs.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    start_time = time.time()

    items = parse_research_list()
    if not items:
        print("No unchecked items in Research List.")
        log_run("skipped", 0, error="No items")
        return

    item = items[0]
    content = item["content"]
    url = extract_url(content)
    output = output_path_for(content)

    print(f"Item: {content}")
    print(f"URL: {url or '(none)'}")
    print(f"Output: {output}")

    # Idempotency: check if research file already exists (orphan from previous timeout)
    if output.exists() and output.stat().st_size > 100:
        print(f"Research file already exists ({output.stat().st_size} bytes) — skipping research, updating list")
        update_research_list(item["raw"], output)
        duration_ms = int((time.time() - start_time) * 1000)
        log_run("success", duration_ms, output, error="idempotent-skip")
        return

    # Route to appropriate method
    output.parent.mkdir(parents=True, exist_ok=True)

    if url and is_twitter_url(url):
        print("Route: Chrome (Twitter/X URL)")
        success = research_with_chrome(url, content, output)
    elif url:
        print("Route: Parallel AI (non-Twitter URL)")
        success = research_with_parallel(content, output)
    else:
        print("Route: Parallel AI (topic)")
        success = research_with_parallel(content, output)

    duration_ms = int((time.time() - start_time) * 1000)

    if success and output.exists():
        update_research_list(item["raw"], output)
        log_run("success", duration_ms, output)
        print(f"\nDone in {duration_ms / 1000:.1f}s")
    elif output.exists() and output.stat().st_size > 100:
        # Research completed but success flag was wrong (e.g. claude returned non-zero but wrote file)
        update_research_list(item["raw"], output)
        log_run("success", duration_ms, output, error="partial-success")
        print(f"\nPartial success in {duration_ms / 1000:.1f}s (file exists)")
    else:
        log_run("error", duration_ms, output, error="Research failed")
        print(f"\nFailed after {duration_ms / 1000:.1f}s")
        sys.exit(1)


if __name__ == "__main__":
    main()
