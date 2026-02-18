#!/usr/bin/env python3
"""
Atlas Reliability Check - Health monitoring for all Atlas services.

Queries launchd services, parses logs for errors, sends Telegram alerts on failures,
and generates daily health reports.
"""

import os
import re
import socket
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# Import shared paths
from lib.paths import INGESTION_ROOT, LOGS_ROOT, VAULT_HEALTH_REPORTS

# Load environment variables from central secrets file
CENTRAL_ENV = INGESTION_ROOT.parent / "dev" / "Ops" / ".env"
load_dotenv(CENTRAL_ENV)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
AUTHORIZED_USER_IDS = os.getenv("AUTHORIZED_USER_IDS", "").split(",")

# Use shared paths
LOG_DIR = LOGS_ROOT
HEALTH_REPORTS_DIR = VAULT_HEALTH_REPORTS

# Service configuration with categories
SERVICES = {
    # === Running Services (always-on daemons) ===
    "connector-backend": {
        "label": "com.atlas.connector-backend",
        "type": "daemon",
        "category": "Running Services",
        "port": 8767,  # Check port instead of launchctl
        "log_dir": "connector-backend",
        "description": "API Server",
    },
    "connector-frontend": {
        "label": "com.atlas.connector-frontend",
        "type": "daemon",
        "category": "Running Services",
        "port": 5174,  # Check port instead of launchctl
        "log_dir": "connector-frontend",
        "description": "Dashboard",
    },
    "telegram-agent": {
        "label": "com.atlas.telegram-agent",
        "type": "daemon",
        "category": "Running Services",
        "log_dir": "telegram-agent",
        "description": "Telegram OAuth",
    },
    "atlas-bot": {
        "label": "com.dkos.atlas-bot",
        "type": "daemon",
        "category": "Running Services",
        "log_dir": "atlas-bot",
        "description": "Telegram Bot",
    },
    # === Ingestion (data sync jobs) ===
    "telegram-sync": {
        "label": "com.atlas.telegram-sync",
        "type": "interval",
        "category": "Ingestion",
        "expected_interval_minutes": 10,
        "log_dir": "telegram-sync",
        "description": "Telegram Ingestion",
    },
    "slack-sync": {
        "label": "com.atlas.slack-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "slack-sync",
        "description": "Slack Sync",
    },
    "calendar-sync": {
        "label": "com.atlas.calendar-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "calendar-sync",
        "description": "Calendar Sync",
    },
    "gmail-sync": {
        "label": "com.atlas.gmail-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "gmail-sync",
        "description": "Gmail Sync",
    },
    "notion-sync": {
        "label": "com.atlas.notion-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "notion-sync",
        "description": "Notion Sync",
    },
    "linear-sync": {
        "label": "com.atlas.linear-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "linear-sync",
        "description": "Linear Sync",
    },
    "granola-sync": {
        "label": "com.atlas.granola-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "granola-sync",
        "description": "Meeting Notes Sync",
    },
    "github-sync": {
        "label": "com.atlas.github-sync",
        "type": "scheduled",
        "category": "Ingestion",
        "log_dir": "github-sync",
        "description": "GitHub Sync",
    },
    # === Workflows (scheduled automations) ===
    "morning-brief": {
        "label": "com.dkos.morning-brief",
        "type": "interval",
        "category": "Workflows",
        "expected_interval_minutes": 30,
        "log_dir": "morning-brief",
        "description": "Morning Brief",
    },
    "telegram-summary": {
        "label": "com.dkos.telegram-summary",
        "type": "scheduled",
        "category": "Workflows",
        "log_dir": "telegram-summary",
        "description": "Telegram Summary",
    },
    "weekly-review": {
        "label": "com.dkos.weekly-review",
        "type": "scheduled",
        "category": "Workflows",
        "log_dir": "weekly-review",
        "description": "Weekly Review",
    },
    "crm-update": {
        "label": "com.dkos.crm-update",
        "type": "scheduled",
        "category": "Workflows",
        "log_dir": "crm-update",
        "description": "CRM Update",
    },
}

# Error patterns to search for in logs
ERROR_PATTERNS = [
    r"error",
    r"exception",
    r"traceback",
    r"failed",
    r"ModuleNotFoundError",
    r"ImportError",
    r"ConnectionError",
    r"TimeoutError",
    r"exit code [1-9]",
]


def check_port(port: int, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    """Check if a port is listening."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            return result == 0
    except Exception:
        return False


def get_launchctl_status():
    """Get status of all services via launchctl list."""
    try:
        result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=10)
        services = {}
        for line in result.stdout.strip().split("\n")[1:]:  # Skip header
            parts = line.split("\t")
            if len(parts) >= 3:
                pid, status, label = parts[0], parts[1], parts[2]
                services[label] = {
                    "pid": pid if pid != "-" else None,
                    "exit_code": int(status) if status != "-" else None,
                }
        return services
    except Exception as e:
        print(f"Error getting launchctl status: {e}")
        return {}


def parse_log_for_errors(log_path: Path, hours: int = 24) -> list:
    """Parse log file for errors in the last N hours."""
    errors = []
    cutoff = datetime.now() - timedelta(hours=hours)

    if not log_path.exists():
        return errors

    try:
        with open(log_path, errors="ignore") as f:
            content = f.read()

        # Combine all error patterns into one regex
        pattern = re.compile("|".join(ERROR_PATTERNS), re.IGNORECASE)

        for line in content.split("\n"):
            if pattern.search(line):
                # Try to extract timestamp if present
                # Common formats: 2026-01-22 10:30:00 or [2026-01-22T10:30:00]
                errors.append(line.strip()[:200])  # Truncate long lines

    except Exception as e:
        errors.append(f"Error reading log: {e}")

    return errors[:20]  # Limit to 20 most recent errors


def get_log_files(service_name: str) -> list:
    """Get log files for a service from both tmp and persistent locations."""
    log_files = []

    # Check /tmp (current logs)
    tmp_patterns = [
        f"/tmp/{service_name}.log",
        f"/tmp/{service_name}.error.log",
        f"/tmp/{service_name}.stdout.log",
        f"/tmp/{service_name}.stderr.log",
    ]
    for pattern in tmp_patterns:
        if os.path.exists(pattern):
            log_files.append(Path(pattern))

    # Check persistent logs
    persistent_dir = LOG_DIR / SERVICES.get(service_name, {}).get("log_dir", service_name)
    if persistent_dir.exists():
        log_files.extend(persistent_dir.glob("*.log"))

    return log_files


def get_last_run_time(log_files: list) -> datetime | None:
    """Get the most recent modification time from log files."""
    if not log_files:
        return None

    latest = None
    for log_file in log_files:
        try:
            mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
            if latest is None or mtime > latest:
                latest = mtime
        except Exception:
            pass

    return latest


def analyze_service(name: str, config: dict, launchctl_status: dict) -> dict:
    """Analyze a single service's health."""
    label = config["label"]
    status_info = launchctl_status.get(label, {})

    # Get basic status
    pid = status_info.get("pid")
    exit_code = status_info.get("exit_code")

    # Determine status
    if config["type"] == "daemon":
        # For services with a port, check port instead of launchctl
        if "port" in config:
            port_up = check_port(config["port"])
            if port_up:
                status = "running"
                healthy = True
            else:
                status = "stopped"
                healthy = False
        # Daemons should be running
        elif pid is not None:
            status = "running"
            healthy = True
        elif exit_code is not None and exit_code != 0:
            status = "failed"
            healthy = False
        else:
            status = "stopped"
            healthy = False
    else:
        # Scheduled/interval services
        if exit_code is None:
            status = "idle"
            healthy = True
        elif exit_code == 0:
            status = "ok"
            healthy = True
        else:
            status = "failed"
            healthy = False

    # Get log info
    log_files = get_log_files(name)
    errors = []
    for log_file in log_files:
        errors.extend(parse_log_for_errors(log_file))

    last_run = get_last_run_time(log_files)

    # Check for staleness (for interval services)
    stale = False
    if config["type"] == "interval" and last_run:
        expected_interval = config.get("expected_interval_minutes", 60)
        if datetime.now() - last_run > timedelta(minutes=expected_interval * 2):
            stale = True
            healthy = False

    return {
        "name": name,
        "label": label,
        "description": config["description"],
        "type": config["type"],
        "status": status,
        "healthy": healthy,
        "pid": pid,
        "exit_code": exit_code,
        "last_run": last_run,
        "stale": stale,
        "errors": errors[:5],  # Top 5 errors
        "error_count": len(errors),
    }


def generate_health_report(results: list) -> str:
    """Generate markdown health report."""
    today = datetime.now().strftime("%Y-%m-%d")
    timestamp = datetime.now().strftime("%H:%M")

    healthy_count = sum(1 for r in results if r["healthy"])
    failing_count = len(results) - healthy_count

    # Header
    report = f"""# Atlas Health Report — {today}

*Generated at {timestamp}*

## Summary
{"✅" if failing_count == 0 else "⚠️"} **{healthy_count}/{len(results)} services healthy** | {"🎉 All systems operational" if failing_count == 0 else f"❌ {failing_count} failing"}

## Service Status

| Service | Status | Last Run | Errors (24h) | Notes |
|---------|--------|----------|--------------|-------|
"""

    # Sort: failing first, then by name
    sorted_results = sorted(results, key=lambda r: (r["healthy"], r["name"]))

    for r in sorted_results:
        status_icon = "✅" if r["healthy"] else "❌"
        status_text = r["status"].upper()

        last_run = r["last_run"].strftime("%H:%M") if r["last_run"] else "—"

        errors_text = str(r["error_count"]) if r["error_count"] > 0 else "—"

        notes = []
        if r["stale"]:
            notes.append("Stale")
        if r["exit_code"] and r["exit_code"] != 0:
            notes.append(f"Exit {r['exit_code']}")
        if r["pid"]:
            notes.append(f"PID {r['pid']}")

        notes_text = ", ".join(notes) if notes else "—"

        report += f"| {r['name']} | {status_icon} {status_text} | {last_run} | {errors_text} | {notes_text} |\n"

    # Error details
    services_with_errors = [r for r in results if r["errors"]]
    if services_with_errors:
        report += "\n## Error Details\n\n"
        for r in services_with_errors:
            report += f"### {r['name']}\n```\n"
            for error in r["errors"][:3]:
                report += f"{error}\n"
            report += "```\n\n"

    # Recommendations
    failing_services = [r for r in results if not r["healthy"]]
    if failing_services:
        report += "## Recommendations\n\n"
        for r in failing_services:
            if "ModuleNotFoundError" in str(r["errors"]):
                report += f"- [ ] **{r['name']}**: Fix missing Python module (check venv activation)\n"
            elif r["exit_code"] == 1:
                report += f"- [ ] **{r['name']}**: Debug exit code 1 — check error logs\n"
            elif r["stale"]:
                report += f"- [ ] **{r['name']}**: Service appears stale — check if launchd is running it\n"
            elif r["type"] == "daemon" and r["status"] == "stopped":
                report += f"- [ ] **{r['name']}**: Daemon not running — try `launchctl start {r['label']}`\n"
            else:
                report += f"- [ ] **{r['name']}**: Investigate failure\n"

    report += "\n---\n*Generated by Atlas Reliability Monitor*\n"

    return report


def send_telegram_alert(results: list):
    """Send Telegram alert for failing services."""
    if not TELEGRAM_BOT_TOKEN or not AUTHORIZED_USER_IDS:
        print("Telegram credentials not configured, skipping alert")
        return

    failing = [r for r in results if not r["healthy"]]
    if not failing:
        return

    message = "⚠️ **Atlas Health Alert**\n\n"
    message += "**FAILING SERVICES:**\n"

    for r in failing:
        error_hint = ""
        if r["errors"]:
            # Extract key error info
            first_error = r["errors"][0]
            if "ModuleNotFoundError" in first_error:
                match = re.search(r"No module named '([^']+)'", first_error)
                if match:
                    error_hint = f"Missing: {match.group(1)}"
            elif "Error" in first_error or "Exception" in first_error:
                error_hint = first_error[:50]

        if not error_hint and r["exit_code"]:
            error_hint = f"Exit code {r['exit_code']}"

        message += f"• {r['name']}: {error_hint or r['status']}\n"

    message += "\n_Run /health for full report_"

    # Send to all authorized users
    for user_id in AUTHORIZED_USER_IDS:
        if not user_id.strip():
            continue
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
            response = requests.post(
                url, json={"chat_id": user_id.strip(), "text": message, "parse_mode": "Markdown"}, timeout=10
            )
            if response.status_code == 200:
                print(f"Alert sent to user {user_id}")
            else:
                print(f"Failed to send alert: {response.text}")
        except Exception as e:
            print(f"Error sending Telegram alert: {e}")


def cleanup_old_logs(days: int = 7):
    """Delete logs older than N days."""
    cutoff = datetime.now() - timedelta(days=days)

    for service_dir in LOG_DIR.iterdir():
        if not service_dir.is_dir():
            continue

        for log_file in service_dir.glob("*.log"):
            try:
                mtime = datetime.fromtimestamp(log_file.stat().st_mtime)
                if mtime < cutoff:
                    log_file.unlink()
                    print(f"Deleted old log: {log_file}")
            except Exception as e:
                print(f"Error cleaning up {log_file}: {e}")


def main():
    """Run the reliability check."""
    print(f"Atlas Reliability Check - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Get launchctl status
    launchctl_status = get_launchctl_status()

    # Analyze each service
    results = []
    for name, config in SERVICES.items():
        result = analyze_service(name, config, launchctl_status)
        result["category"] = config.get("category", "Other")
        results.append(result)

    # Print grouped by category
    categories = ["Running Services", "Ingestion", "Workflows"]
    for category in categories:
        cat_results = [r for r in results if r["category"] == category]
        if cat_results:
            print(f"\n{category}:")
            for result in cat_results:
                status_icon = "✅" if result["healthy"] else "❌"
                print(f"  {status_icon} {result['description']}: {result['status']}")

    print("=" * 60)

    # Generate and save report
    report = generate_health_report(results)
    today = datetime.now().strftime("%Y-%m-%d")
    report_path = HEALTH_REPORTS_DIR / f"{today}.md"

    HEALTH_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        f.write(report)
    print(f"Report saved to: {report_path}")

    # Send alert if any failures
    failing_count = sum(1 for r in results if not r["healthy"])
    if failing_count > 0:
        print(f"⚠️ {failing_count} services failing - sending alert...")
        send_telegram_alert(results)
    else:
        print("✅ All services healthy")

    # Cleanup old logs
    cleanup_old_logs(days=7)

    # Return 0 = check ran successfully (regardless of service health)
    # The check's job is to report, not to fail when services are unhealthy
    return 0


if __name__ == "__main__":
    exit(main())
