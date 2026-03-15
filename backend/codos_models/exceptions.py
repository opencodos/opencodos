"""Shared exception types for the Codos backend."""


class DependencyNotInstalledException(RuntimeError):
    """A required external dependency (e.g. bun, claude CLI) is not installed."""


class InvalidInputError(ValueError):
    """A user-provided value failed validation."""
