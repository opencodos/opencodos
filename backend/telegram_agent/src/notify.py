"""Notification utilities for Telegram agent."""


def send_notification(message: str):
    """Send a notification (stub)."""
    print(f"[NOTIFY] {message}")


# Alias used by agent.py for sync failure notifications
notify_sync_failure = send_notification
