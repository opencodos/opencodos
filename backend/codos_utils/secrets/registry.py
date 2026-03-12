from __future__ import annotations

import importlib
import json
import logging
import pkgutil

from backend.codos_utils.paths import CONFIG_FILE
from backend.codos_utils.secrets.protocol import SecretsBackend, SecretsBackendType

logger = logging.getLogger(__name__)


class SecretsBackendRegistry:
    def __init__(self) -> None:
        self._backends: dict[SecretsBackendType, SecretsBackend] = {}
        self._discovered = False

    def _discover(self) -> None:
        if self._discovered:
            return
        self._discovered = True
        package = importlib.import_module("backend.codos_utils.secrets")
        for info in pkgutil.iter_modules(package.__path__):
            module = importlib.import_module(f"backend.codos_utils.secrets.{info.name}")
            for attr in vars(module).values():
                if not isinstance(attr, type) or attr.__module__ != module.__name__:
                    continue
                try:
                    instance = attr()
                except TypeError:
                    continue
                if isinstance(instance, SecretsBackend):
                    backend_type = instance.backend_type()
                    logger.debug("Registered secrets backend: %s", backend_type.value)
                    self._backends[backend_type] = instance

    def read_backend_type(self) -> SecretsBackendType:
        """Return the configured backend type from config.json."""
        if not CONFIG_FILE.exists():
            return SecretsBackendType.JSON_FILE
        with open(CONFIG_FILE) as f:
            config = json.load(f)
        raw = config.get("secrets_backend")
        if not raw:
            return SecretsBackendType.JSON_FILE
        return SecretsBackendType(raw)

    def get(self) -> SecretsBackend:
        """Return the configured backend instance."""
        self._discover()
        backend_type = self.read_backend_type()
        logger.info("Using secrets backend: %s", backend_type.value)
        instance = self._backends.get(backend_type)
        if instance is None:
            raise NotImplementedError(
                f"Secrets backend {backend_type.value!r} is not yet implemented. "
                f"Available: {', '.join(b.value for b in self._backends)}"
            )
        return instance
