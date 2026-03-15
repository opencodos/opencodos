"""Telegram auth state models."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel


class AuthStatus(StrEnum):
    NOT_STARTED = "not_started"
    INITIATING = "initiating"
    PENDING = "pending"
    NEEDS_2FA = "needs_2fa"
    AUTHENTICATED = "authenticated"
    EXPIRED = "expired"
    ERROR = "error"


class TelegramAuthState(BaseModel):
    """Current state of the Telegram authentication flow."""

    status: AuthStatus = AuthStatus.NOT_STARTED
    username: str | None = None
    user_id: int | None = None
    qr_image: str | None = None
    message: str | None = None

    def set_authenticated(self, username: str | None, user_id: int) -> None:
        """Transition to authenticated after successful login."""
        self.status = AuthStatus.AUTHENTICATED
        self.username = username
        self.user_id = user_id
        self.message = "Login successful"

    def reset(self) -> None:
        """Reset to initial state."""
        self.status = AuthStatus.NOT_STARTED
        self.username = None
        self.user_id = None
        self.qr_image = None
        self.message = None
