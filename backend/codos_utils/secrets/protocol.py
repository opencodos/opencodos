"""Secrets backend protocol — abstract interface for pluggable secrets storage.

All secrets backends must implement SecretsBackend. The factory in
``codos_utils.secrets`` reads the user's chosen backend from
``~/.codos/config.json`` and returns the corresponding implementation.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol, runtime_checkable


class SecretsBackendType(StrEnum):
    """Available secrets backend implementations.

    Future backends: macos_keychain, encrypted_file, hashicorp_vault.
    """

    JSON_FILE = "json_file"


@runtime_checkable
class SecretsBackend(Protocol):
    """Abstract interface for a secrets storage backend."""

    def backend_type(self) -> SecretsBackendType:
        """Return the enum value identifying this backend."""
        ...

    def get(self, key: str) -> str | None:
        """Return the secret value for *key*, or ``None`` if not set."""
        ...

    def set(self, key: str, value: str) -> None:
        """Store a secret under *key*."""
        ...

    def delete(self, key: str) -> None:
        """Remove a secret. No-op if *key* does not exist."""
        ...

    def get_all(self) -> dict[str, str]:
        """Return all stored secrets as a dict."""
        ...
