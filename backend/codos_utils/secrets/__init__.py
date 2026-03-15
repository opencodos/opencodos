from __future__ import annotations

from backend.codos_utils.secrets.protocol import SecretsBackend, SecretsBackendType
from backend.codos_utils.secrets.registry import SecretsBackendRegistry

_registry = SecretsBackendRegistry()


def get_secrets_backend() -> SecretsBackend:
    return _registry.get()


def get_secrets_backend_type() -> SecretsBackendType:
    return _registry.read_backend_type()
