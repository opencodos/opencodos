"""JSON-file secrets backend (``~/.codos/secrets.json``).

Stores secrets as a flat JSON object with atomic writes and ``0o600``
permissions.  This is the default backend — a direct replacement for the
previous ``dev/Ops/.env`` approach, but with a single canonical location.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from backend.codos_utils.paths import SECRETS_FILE
from backend.codos_utils.secrets.protocol import SecretsBackendType


class JsonFileBackend:
    """Read/write secrets from ``~/.codos/secrets.json``."""

    def backend_type(self) -> SecretsBackendType:
        return SecretsBackendType.JSON_FILE

    def __init__(self, path: Path | None = None) -> None:
        self._path = path or SECRETS_FILE

    def get(self, key: str) -> str | None:
        return self._read().get(key)

    def set(self, key: str, value: str) -> None:
        data = self._read()
        data[key] = value
        self._write(data)

    def delete(self, key: str) -> None:
        data = self._read()
        if key in data:
            del data[key]
            self._write(data)

    def get_all(self) -> dict[str, str]:
        return self._read()

    # -- Internal ----------------------------------------------------------

    def _read(self) -> dict[str, str]:
        if not self._path.exists():
            return {}
        with open(self._path) as f:
            envelope = json.load(f)
        return dict(envelope.get("secrets", {}))

    def _write(self, secrets: dict[str, str]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        envelope = {"secrets": secrets}
        payload = json.dumps(envelope, indent=2) + "\n"

        fd, tmp_path = tempfile.mkstemp(
            dir=str(self._path.parent),
            prefix=".secrets_",
            suffix=".tmp",
        )
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, payload.encode())
            os.close(fd)
            os.rename(tmp_path, str(self._path))
        except BaseException:
            try:
                os.close(fd)
            except OSError:
                pass
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise
