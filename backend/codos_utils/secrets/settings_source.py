"""Pydantic settings source backed by the pluggable secrets system.

Allows ``pydantic_settings.BaseSettings`` subclasses to read field values
directly from the configured secrets backend (e.g. ``~/.codos/secrets.json``).
"""

from __future__ import annotations

from typing import Any

from pydantic.fields import FieldInfo
from pydantic_settings import PydanticBaseSettingsSource

from backend.codos_utils.secrets import get_secrets_backend


class SecretsBackendSource(PydanticBaseSettingsSource):
    """Pydantic settings source that reads values from the secrets backend."""

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        value = get_secrets_backend().get(field_name.upper())
        return value, field_name, False

    def __call__(self) -> dict[str, Any]:
        all_secrets = get_secrets_backend().get_all()
        d: dict[str, Any] = {}
        for field_name in self.settings_cls.model_fields:
            env_name = field_name.upper()
            if env_name in all_secrets:
                d[field_name] = all_secrets[env_name]
        return d
