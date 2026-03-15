"""Vault and repo folder creation, templates, and workspace validation."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from backend.codos_models.exceptions import InvalidInputError

VAULT_FOLDERS = [
    "Core Memory",
    "0 - Daily Briefs",
    "0 - Weekly Reviews",
    "1 - Inbox (Last 7 days)",
    "2 - Projects",
    "3 - Todos",
    "4 - CRM",
    "5 - Agent Memory",
    "Archived data",
]

WORKSPACE_NAME_RE = re.compile(r"^[\w\-\s]{1,100}$")


def ensure_vault_dirs(base_path: Path) -> None:
    """Ensure all standard vault subdirectories exist."""
    for folder in VAULT_FOLDERS:
        (base_path / folder).mkdir(parents=True, exist_ok=True)


def create_codos_folder_structure(base_path: Path) -> None:
    """Create the standard Codos repo folder structure."""
    for folder in ("skills", "ingestion", "hooks", "dev", "dev/Ops"):
        (base_path / folder).mkdir(parents=True, exist_ok=True)


def create_vault_folder_structure(base_path: Path) -> None:
    """Create the standard vault folder structure with template files."""
    ensure_vault_dirs(base_path)
    create_vault_template_files(base_path)


def create_vault_template_files(base_path: Path) -> None:
    """Create template files in a new vault (About me.md, Goals.md, System.md)."""
    ensure_vault_dirs(base_path)

    # About me.md template
    about_me = base_path / "Core Memory" / "About me.md"
    if not about_me.exists():
        about_me.write_text("""# About Me

## Background
<!-- Your background, role, and context -->

## Preferences
- Communication style: <!-- direct/detailed/casual -->
- Timezone: <!-- e.g., Europe/Madrid -->

## Work Context
<!-- Your current role, projects, and priorities -->

---

*Update this file to help Atlas understand who you are.*
""")

    # Goals.md template
    goals = base_path / "Core Memory" / "Goals.md"
    if not goals.exists():
        goals.write_text("""# Goals

### Short-term goals

1. <!-- Your first goal -->
2. <!-- Your second goal -->
3. <!-- Your third goal -->

### Long-term goals

<!-- What are you working towards? -->

---

*Update this file to help Atlas understand what you're working on.*
""")

    # Learnings.md template
    learnings = base_path / "Core Memory" / "Learnings.md"
    if not learnings.exists():
        learnings.write_text("""# Learnings

> Accumulated insights from /compound sessions.

## Tactical Patterns
<!-- Observations about what works -->

## Blockers to Watch
<!-- Recurring issues that derail progress -->

## Process Improvements
<!-- Better ways of working discovered -->

---

*Updated by /compound — Review and prune periodically.*
""")

    # System.md template
    system_md = base_path / "System.md"
    if not system_md.exists():
        system_md.write_text("""# System

Operating rules and preferences for Atlas.

## Communication Style
<!-- How should Atlas communicate with you? -->

## Priorities
<!-- What should Atlas prioritize? -->

## Constraints
<!-- Any limitations or things to avoid? -->

---

*Update this file to customize how Atlas operates.*
""")


def sanitize_workspace_name(name: str) -> str:
    """Return a filesystem-safe version of *name*."""
    return re.sub(r"[^\w\-\s]", "", name).strip() or "Workspace"


def is_placeholder_about_name(value: str) -> bool:
    """Return True if *value* looks like a placeholder name."""
    candidate = (value or "").strip().lower()
    return candidate in {"", "user", "unknown", "<!-- your name -->", "your name", "name"}


def seed_about_me_name(vault_path: Path, user_name: str) -> None:
    """Write user's name to About me.md once during setup.

    Safe behavior:
    - If About me.md has a non-placeholder name, keep it.
    - If file has no name line or a placeholder, write/update ``- Name: ...``.
    """
    normalized_name = (user_name or "").strip()
    if not normalized_name:
        return

    create_vault_template_files(vault_path)
    about_me_path = vault_path / "Core Memory" / "About me.md"
    if not about_me_path.exists():
        return

    content = about_me_path.read_text(encoding="utf-8")
    name_line_regex = r"^(\s*[-*]?\s*Name[^:]*:\s*)(.+?)\s*$"
    match = re.search(name_line_regex, content, flags=re.IGNORECASE | re.MULTILINE)

    if match:
        existing_raw = match.group(2)
        existing_clean = re.sub(r"<!--.*?-->", "", existing_raw).strip()
        if not is_placeholder_about_name(existing_clean):
            return
        updated = re.sub(
            name_line_regex,
            rf"\1{normalized_name}",
            content,
            count=1,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        about_me_path.write_text(updated, encoding="utf-8")
        return

    if re.search(r"^##\s*Background\s*$", content, flags=re.IGNORECASE | re.MULTILINE):
        updated = re.sub(
            r"^##\s*Background\s*$",
            f"## Background\n- Name: {normalized_name}",
            content,
            count=1,
            flags=re.IGNORECASE | re.MULTILINE,
        )
    else:
        updated = f"# About Me\n\n## Background\n- Name: {normalized_name}\n\n{content}".strip() + "\n"

    about_me_path.write_text(updated, encoding="utf-8")


def validate_workspace_name(name: str) -> str:
    """Validate and return the workspace name.

    Raises ``InvalidInputError`` if the name is empty or contains
    invalid characters.
    """
    workspace_name = (name or "").strip()
    if not workspace_name:
        raise InvalidInputError("Workspace name is required")
    if "/" in workspace_name or "\\" in workspace_name or workspace_name in {".", ".."}:
        raise InvalidInputError("Workspace name contains invalid characters")
    if not WORKSPACE_NAME_RE.fullmatch(workspace_name):
        raise InvalidInputError("Workspace name must contain only letters, numbers, spaces, _ or -")
    return workspace_name


def write_goals_file(vault_path: Path, goals_text: str) -> None:
    """Parse and write goals to ``Vault/Core Memory/Goals.md``."""
    if not goals_text or not goals_text.strip():
        return

    core_memory_dir = Path(vault_path) / "Core Memory"
    core_memory_dir.mkdir(parents=True, exist_ok=True)
    goals_file = core_memory_dir / "Goals.md"

    goals_lines = [line.strip() for line in goals_text.strip().split("\n") if line.strip()]
    cleaned_goals = []
    for line in goals_lines:
        cleaned = re.sub(r"^\d+[\.\)\:]\s*", "", line)
        if cleaned:
            cleaned_goals.append(cleaned)

    goals_content = f"""# Goals

### Short-term goals

{chr(10).join(f"{i + 1}. {goal}" for i, goal in enumerate(cleaned_goals))}

---

*Updated via Codos Setup on {datetime.utcnow().strftime("%Y-%m-%d")}*
"""
    with open(goals_file, "w") as f:
        f.write(goals_content)
