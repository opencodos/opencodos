"""Tests for logging configuration."""

from __future__ import annotations

import logging

from backend.codos_utils.log import _InterceptHandler, configure_logging


class TestInterceptHandler:
    def test_unknown_level_falls_back_to_levelno(self):
        handler = _InterceptHandler()
        record = logging.LogRecord(
            name="test",
            level=99,  # non-standard level
            pathname="test.py",
            lineno=1,
            msg="test message",
            args=(),
            exc_info=None,
        )
        record.levelname = "CUSTOM_NONEXISTENT_LEVEL"
        # Should not raise — falls back to record.levelno
        handler.emit(record)

    def test_walks_frames(self):
        configure_logging("test-service", intercept_stdlib=True)
        stdlib_logger = logging.getLogger("test.frame_walk")
        # This exercises the frame-walking loop because stdlib logging
        # adds its own frames before reaching the handler
        stdlib_logger.warning("frame walk test")
