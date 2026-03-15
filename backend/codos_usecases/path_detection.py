"""Detect existing Codos repo and vault paths on disk."""

from __future__ import annotations

from pathlib import Path

from backend.codos_models.settings import settings

SUGGESTED_CODOS_PATH = Path.home() / "codos"

COMMON_CODOS_LOCATIONS = [
    Path.home() / "codos",
    Path.home() / "Desktop" / "codos",
    Path.home() / "Desktop" / "codos" / "codos",
    Path.home() / "projects" / "codos",
    Path.home() / "Code" / "codos",
]

COMMON_VAULT_LOCATIONS = [
    Path.home() / "projects" / "codos_vault",
    Path.home() / "codos" / "vault",
]


def is_codos_repo(path: Path) -> bool:
    """Return True if *path* looks like the root of a Codos repo."""
    return (path / "skills").exists() and (path / "backend" / "codos_services" / "gateway").exists()


def is_vault(path: Path) -> bool:
    """Return True if *path* looks like a Codos vault directory."""
    return (path / "Core Memory").exists()


def get_repo_root(start: Path | None = None) -> Path | None:
    """Walk parents from *start* to find the Codos repo root.

    If *start* is None, uses the location of the gateway package.
    """
    try:
        if start is None:
            start = Path(__file__).resolve()
        for parent in start.parents:
            if is_codos_repo(parent):
                return parent
    except Exception:
        pass
    return None


def detect_existing_paths() -> tuple[str | None, str | None]:
    """Detect existing codos and vault paths.

    Priority:
    1. ``CODOS_ROOT`` / ``VAULT_PATH`` env vars (bundle mode)
    2. Walk from current file to find repo root
    3. Scan common locations
    """
    codos_path: str | None = None
    vault_path: str | None = None
    env_codos = settings.codos_root
    if env_codos and Path(env_codos).exists():
        codos_path = env_codos

    if not codos_path:
        repo_root = get_repo_root()
        if repo_root and is_codos_repo(repo_root):
            codos_path = str(repo_root)

    if not codos_path:
        for path in COMMON_CODOS_LOCATIONS:
            if path.exists() and is_codos_repo(path):
                codos_path = str(path)
                break

    # Bundle mode: VAULT_PATH may be set
    env_vault = settings.vault_path
    if env_vault and Path(env_vault).exists():
        vault_path = env_vault

    if not vault_path:
        for path in COMMON_VAULT_LOCATIONS:
            if path.exists() and is_vault(path):
                vault_path = str(path)
                break

    return codos_path, vault_path
