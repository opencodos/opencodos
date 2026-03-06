"""Shared logging configuration for all Codos services.

Usage:
    from backend.codos_utils.log import configure_logging
    configure_logging("my-service")
"""

import logging
import sys

from loguru import logger


class _InterceptHandler(logging.Handler):
    """Route stdlib logging through loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def configure_logging(
    service: str,
    level: str = "INFO",
    log_file: str | None = None,
    intercept_stdlib: bool = True,
) -> None:
    """Configure loguru for a service.

    Args:
        service: Name shown in log lines.
        level: Minimum log level for stderr output.
        log_file: Optional path for a JSON log file (uses same level).
        intercept_stdlib: If True, redirect stdlib logging through loguru.
    """
    logger.remove()
    logger.add(
        sys.stderr,
        format="{time:YYYY-MM-DD HH:mm:ss} {level} [" + service + "] {message}",
        level=level,
        colorize=True,
    )
    if log_file:
        logger.add(log_file, serialize=True, level=level)
    if intercept_stdlib:
        logging.basicConfig(handlers=[_InterceptHandler()], level=0, force=True)
