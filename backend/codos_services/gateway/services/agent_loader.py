"""Agent loader service.

Reads agent configs with Vault-first override logic:
  - Vault prompt (Vault/5 - Agent Memory/{id}/prompt.md) wins if it exists
  - Repo prompt (codos/agents/{id}/prompt.md) is the generic default
  - UI edits save to Vault (never writes to repo)
  - Deleting Vault version = "reset to defaults" (repo shows through)

Also injects shared context (Core Memory) into every agent session.
"""

import time
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from loguru import logger

from backend.codos_models import settings as _settings_mod  # access via module to survive reload_settings()

# Legacy agent_id -> new folder name mapping (backward compat)
LEGACY_ID_MAP = {
    "engineer": "karpathy",
    "researcher": "mckinsey",
    "hr": "hillary",
    "writer": "chief-content",
    "sales": "cgo",
}


@dataclass
class AgentConfig:
    id: str
    name: str
    role: str
    icon: str = "bot"
    color: str = "orange"
    skills: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    prompt: str = ""
    memory: list[str] = field(default_factory=list)


def _get_agents_dir() -> Path:
    """Return the agents config directory in the codos repo."""
    return _settings_mod.settings.get_codos_path() / "agents"


def _get_memory_dir() -> Path:
    """Return the agent memory directory in the Vault."""
    return _settings_mod.settings.get_vault_path() / "5 - Agent Memory"


def _resolve_agent_id(agent_id: str) -> str:
    """Resolve legacy agent IDs to new folder names."""
    return LEGACY_ID_MAP.get(agent_id, agent_id)


def _parse_prompt_md(text: str) -> tuple[dict, str]:
    """Parse a prompt.md file into frontmatter dict and body text.

    Format:
        ---
        key: value
        ---
        Body text here...

    Returns:
        tuple of (frontmatter_dict, body_str)
    """
    text = text.strip()
    if not text.startswith("---"):
        # No frontmatter, entire file is the body
        return {}, text

    # Find the closing ---
    end_idx = text.find("\n---", 3)
    if end_idx == -1:
        return {}, text

    frontmatter_str = text[3:end_idx].strip()
    body = text[end_idx + 4 :].strip()

    try:
        frontmatter = yaml.safe_load(frontmatter_str) or {}
    except yaml.YAMLError as e:
        logger.warning(f"Failed to parse YAML frontmatter: {e}")
        frontmatter = {}

    return frontmatter, body


def parse_agent(agent_id: str) -> AgentConfig | None:
    """Read and parse an agent config with Vault-first prompt lookup.

    Priority: Vault prompt.md > repo prompt.md (full file override).
    Memory always loaded from Vault.

    Args:
        agent_id: Agent identifier (supports legacy IDs like 'engineer')

    Returns:
        AgentConfig or None if no prompt.md found in either location
    """
    resolved_id = _resolve_agent_id(agent_id)

    # Priority: Vault prompt > repo prompt
    vault_prompt = _get_memory_dir() / resolved_id / "prompt.md"
    repo_prompt = _get_agents_dir() / resolved_id / "prompt.md"

    prompt_file = vault_prompt if vault_prompt.exists() else repo_prompt
    if not prompt_file.exists():
        logger.debug(f"Agent config not found in Vault or repo: {resolved_id}")
        return None

    try:
        text = prompt_file.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning(f"Failed to read {prompt_file}: {e}")
        return None

    frontmatter, body = _parse_prompt_md(text)

    # Load memory from Vault
    memory = _load_memory(resolved_id)

    # Extract permissions — handle both flat list and nested {allow: [...]} format
    raw_permissions = frontmatter.get("permissions", [])
    if isinstance(raw_permissions, dict):
        permissions = raw_permissions.get("allow", [])
    else:
        permissions = raw_permissions

    return AgentConfig(
        id=resolved_id,
        name=frontmatter.get("name", resolved_id),
        role=frontmatter.get("role", ""),
        icon=frontmatter.get("icon", "bot"),
        color=frontmatter.get("color", "orange"),
        skills=frontmatter.get("skills", []),
        permissions=permissions,
        prompt=body,
        memory=memory,
    )


def _load_memory(agent_id: str) -> list[str]:
    """Load memory entries from Vault for an agent.

    Memory file format: one entry per line.
    """
    memory_dir = _get_memory_dir()
    memory_file = memory_dir / agent_id / "memory.md"

    if not memory_file.exists():
        return []

    try:
        text = memory_file.read_text(encoding="utf-8").strip()
        if not text:
            return []
        return [line for line in text.splitlines() if line.strip()]
    except OSError as e:
        logger.warning(f"Failed to read memory for {agent_id}: {e}")
        return []


def list_agents() -> list[AgentConfig]:
    """List all agent configs, merging repo defaults + Vault overrides.

    Discovers agents from both repo (agents/) and Vault (5 - Agent Memory/).
    parse_agent() handles Vault > repo priority for each agent.

    Returns:
        List of AgentConfig objects for all valid agents
    """
    agent_ids: set[str] = set()

    # From repo (defaults)
    agents_dir = _get_agents_dir()
    if agents_dir.exists():
        for d in sorted(agents_dir.iterdir()):
            if d.is_dir() and (d / "prompt.md").exists():
                agent_ids.add(d.name)

    # From Vault (personal — may add new agents or override repo ones)
    vault_dir = _get_memory_dir()
    if vault_dir.exists():
        for d in sorted(vault_dir.iterdir()):
            if d.is_dir() and (d / "prompt.md").exists():
                agent_ids.add(d.name)

    # parse_agent() handles Vault > repo priority
    return [c for aid in sorted(agent_ids) if (c := parse_agent(aid))]


def save_agent(config: AgentConfig) -> None:
    """Write agent config to Vault as prompt.md (personal override).

    Saves to Vault/5 - Agent Memory/{id}/prompt.md so repo defaults
    stay untouched. Creates the Vault directory if needed.

    Args:
        config: The agent configuration to save
    """
    vault_dir = _get_memory_dir() / config.id
    vault_dir.mkdir(parents=True, exist_ok=True)

    frontmatter = {
        "name": config.name,
        "role": config.role,
        "icon": config.icon,
        "color": config.color,
        "skills": config.skills,
        "permissions": config.permissions,
    }

    yaml_str = yaml.dump(frontmatter, default_flow_style=False, sort_keys=False)
    content = f"---\n{yaml_str}---\n{config.prompt}\n"

    prompt_file = vault_dir / "prompt.md"
    prompt_file.write_text(content, encoding="utf-8")
    logger.info(f"Saved agent config to Vault: {config.id}")


def delete_agent(agent_id: str) -> bool:
    """Delete an agent — Vault override first, then repo if no Vault version.

    Deleting Vault version = "reset to defaults" (repo prompt shows through).
    Deleting repo version = full removal (user-created agents only).

    Args:
        agent_id: Agent identifier

    Returns:
        True if deleted, False if not found
    """
    resolved_id = _resolve_agent_id(agent_id)
    vault_dir = _get_memory_dir() / resolved_id

    # Delete Vault prompt (personal override)
    vault_prompt = vault_dir / "prompt.md"
    if vault_prompt.exists():
        vault_prompt.unlink()
        # Also clean memory if present
        vault_memory = vault_dir / "memory.md"
        if vault_memory.exists():
            vault_memory.unlink()
        # Remove dir if empty
        if vault_dir.exists() and not any(vault_dir.iterdir()):
            vault_dir.rmdir()
        logger.info(f"Deleted Vault override for agent: {resolved_id}")
        return True

    # If no Vault version, delete repo version (user-created agents only)
    repo_dir = _get_agents_dir() / resolved_id
    if repo_dir.exists():
        import shutil

        shutil.rmtree(repo_dir)
        logger.info(f"Deleted repo agent: {resolved_id}")
        return True

    return False


def append_memory(agent_id: str, entry: str) -> None:
    """Append a memory entry to the agent's Vault memory file.

    Creates the memory directory and file if they don't exist.

    Args:
        agent_id: Agent identifier (supports legacy IDs)
        entry: The memory entry text to append
    """
    resolved_id = _resolve_agent_id(agent_id)
    memory_dir = _get_memory_dir()
    agent_memory_dir = memory_dir / resolved_id
    agent_memory_dir.mkdir(parents=True, exist_ok=True)

    memory_file = agent_memory_dir / "memory.md"

    # Append with timestamp
    timestamp = time.strftime("%Y-%m-%d %H:%M")
    line = f"[{timestamp}] {entry.strip()}\n"

    with open(memory_file, "a", encoding="utf-8") as f:
        f.write(line)

    logger.debug(f"Appended memory for {resolved_id}: {entry[:80]}")


def replace_memory(agent_id: str, content: str) -> None:
    """Replace the full memory content for an agent.

    Creates the memory directory and file if they don't exist.

    Args:
        agent_id: Agent identifier (supports legacy IDs)
        content: The full memory content to write
    """
    resolved_id = _resolve_agent_id(agent_id)
    memory_dir = _get_memory_dir()
    agent_memory_dir = memory_dir / resolved_id
    agent_memory_dir.mkdir(parents=True, exist_ok=True)

    memory_file = agent_memory_dir / "memory.md"
    memory_file.write_text(content, encoding="utf-8")
    logger.info(f"Replaced memory for {resolved_id} ({len(content)} chars)")


def _build_shared_context() -> str:
    """Build shared context from user's Vault Core Memory.

    Injected into every agent session so they know who they work for.
    Returns empty string if no Vault Core Memory exists.
    """
    vault = _settings_mod.settings.get_vault_path()
    sections = []

    # Identity — from About me.md
    about_file = vault / "Core Memory" / "About me.md"
    if about_file.exists():
        try:
            about = about_file.read_text(encoding="utf-8").strip()[:500]
            sections.append(f"## Who You Work For\n{about}")
        except OSError:
            pass

    # Goals — short-term only
    goals_file = vault / "Core Memory" / "Goals.md"
    if goals_file.exists():
        try:
            goals = goals_file.read_text(encoding="utf-8").strip()
            if "### Short-term" in goals:
                start = goals.index("### Short-term")
                end = goals.index("### My 2026") if "### My 2026" in goals else len(goals)
                sections.append(goals[start:end].strip())
        except OSError:
            pass

    # Vault paths
    sections.append(f"""## Key Paths
- Core Memory: {vault}/Core Memory/
- CRM: {vault}/4 - CRM/
- Today's Brief: {vault}/0 - Daily Briefs/
- Today's Todos: {vault}/3 - Todos/
- Inbox: {vault}/1 - Inbox (Last 7 days)/
- Projects: {vault}/2 - Projects/""")

    return "\n\n".join(sections)


def build_session_prompt(agent_id: str, session_id: str) -> str:
    """Compose a CLAUDE.md prompt with persona + skills + memory + session info.

    This replaces the hardcoded AGENT_PROMPTS dicts. The composed prompt is
    written to the session's CLAUDE.md file by the stream/session manager.

    Args:
        agent_id: Agent identifier (supports legacy IDs)
        session_id: The session identifier

    Returns:
        str: The composed CLAUDE.md content
    """
    config = parse_agent(agent_id)
    if not config:
        # Fallback for unknown agents
        return f"""# Atlas Agent Session

## Session Info
- Session ID: {session_id}
- Agent: {agent_id}
- Created: {time.strftime("%Y-%m-%d %H:%M:%S")}

## Instructions
- Stream all responses to the user
- Use tools as needed to complete tasks
- Maintain context across messages
- Be concise but thorough
"""

    # Build the prompt
    sections = []

    sections.append("# Atlas Agent Session")
    sections.append("")

    # 1. Agent persona
    sections.append("## Agent Persona")
    sections.append(config.prompt)
    sections.append("")

    # 2. Shared context (from user's Vault Core Memory — personal)
    shared = _build_shared_context()
    if shared:
        sections.append(shared)
        sections.append("")

    # 3. Session info
    sections.append("## Session Info")
    sections.append(f"- Session ID: {session_id}")
    sections.append(f"- Agent: {config.name} ({config.id})")
    sections.append(f"- Role: {config.role}")
    sections.append(f"- Created: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    sections.append("")

    # 4. Skills
    if config.skills:
        sections.append("## Skills")
        for skill in config.skills:
            sections.append(f"- {skill}")
        sections.append("")

    # 5. Memory (last 20 entries)
    if config.memory:
        recent_memory = config.memory[-20:]
        sections.append("## Recent Memory")
        for entry in recent_memory:
            sections.append(f"- {entry}")
        sections.append("")

    # 6. Instructions
    sections.append("## Instructions")
    sections.append("- Stream all responses to the user")
    sections.append("- Use tools as needed to complete tasks")
    sections.append("- Maintain context across messages")
    sections.append("- Be concise but thorough")

    return "\n".join(sections) + "\n"
