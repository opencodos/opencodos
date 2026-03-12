#!/usr/bin/env python3
"""
GitHub Sync - Fetches recent activity using gh CLI.

Usage: python3 github-sync.py

Outputs to: Vault/1 - Inbox (Last 7 days)/GitHub/{date}.md
"""

import json
import os
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

VAULT_ROOT = os.environ.get("VAULT_PATH", "")
OUTPUT_DIR = Path(VAULT_ROOT) / "1 - Inbox (Last 7 days)/GitHub"

# Repos to track
TRACKED_REPOS = os.environ.get("GITHUB_TRACKED_REPOS", "").split(",") if os.environ.get("GITHUB_TRACKED_REPOS") else []


def get_date():
    return datetime.now().strftime("%Y-%m-%d")


def get_time():
    return datetime.now().strftime("%H:%M")


def run_gh(args):
    """Run gh command and return JSON output."""
    try:
        result = subprocess.run(
            ["gh"] + args,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
        return []
    except Exception as e:
        print(f"gh command failed: {e}")
        return []


def fetch_notifications():
    """Fetch GitHub notifications."""
    return run_gh(["api", "/notifications", "--jq", "."])


def fetch_commits(owner, repo):
    """Fetch recent commits."""
    since = (datetime.now() - timedelta(days=1)).isoformat()
    return run_gh(["api", f"/repos/{owner}/{repo}/commits", "-f", f"since={since}", "-f", "per_page=10", "--jq", "."])


def fetch_prs(owner, repo):
    """Fetch open PRs."""
    return run_gh(["api", f"/repos/{owner}/{repo}/pulls", "-f", "state=open", "-f", "per_page=10", "--jq", "."])


def fetch_issues(owner, repo):
    """Fetch recent issues."""
    return run_gh(["api", f"/repos/{owner}/{repo}/issues", "-f", "state=open", "-f", "per_page=10", "--jq", "."])


def generate_markdown(notifications, repo_data):
    date = get_date()
    time = get_time()

    md = f"# GitHub — {date}\n\n"
    md += f"> Fetched: {date} {time}\n\n"

    # Notifications
    md += "## Notifications\n\n"
    if not notifications:
        md += "No new notifications.\n\n"
    else:
        md += "| Type | Repository | Title |\n"
        md += "|------|------------|-------|\n"
        for n in notifications[:15]:
            ntype = n.get("subject", {}).get("type", "")
            repo = n.get("repository", {}).get("full_name", "")
            title = n.get("subject", {}).get("title", "")[:50]
            md += f"| {ntype} | {repo} | {title} |\n"
        md += "\n"

    # Per-repo activity
    for repo_name, data in repo_data.items():
        commits = data.get("commits", [])
        prs = data.get("prs", [])
        issues = data.get("issues", [])

        md += f"## {repo_name}\n\n"

        # Commits
        if commits:
            md += "### Recent Commits (24h)\n\n"
            for c in commits[:5]:
                msg = c.get("commit", {}).get("message", "").split("\n")[0][:50]
                author = c.get("commit", {}).get("author", {}).get("name", "")
                sha = c.get("sha", "")[:7]
                md += f"- `{sha}` {msg} ({author})\n"
            md += "\n"
        else:
            md += "### Recent Commits (24h)\n\nNo commits in last 24h.\n\n"

        # PRs
        if prs:
            md += "### Open PRs\n\n"
            for pr in prs[:5]:
                title = pr.get("title", "")[:40]
                number = pr.get("number", "")
                user = pr.get("user", {}).get("login", "")
                md += f"- #{number}: {title} (@{user})\n"
            md += "\n"

        # Issues (exclude PRs which also appear in issues)
        real_issues = [i for i in issues if not i.get("pull_request")]
        if real_issues:
            md += "### Open Issues\n\n"
            for issue in real_issues[:5]:
                title = issue.get("title", "")[:40]
                number = issue.get("number", "")
                md += f"- #{number}: {title}\n"
            md += "\n"

    return md


def save_file(content):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = OUTPUT_DIR / f"{get_date()}.md"
    file_path.write_text(content, encoding="utf-8")
    return file_path


def main():
    date = get_date()
    print(f"GitHub sync: {date}")

    # Fetch notifications
    print("Fetching notifications...")
    notifications = fetch_notifications()
    print(f"Found {len(notifications)} notifications")

    # Fetch repo activity
    repo_data = {}
    for repo in TRACKED_REPOS:
        print(f"Fetching activity for {repo}...")
        owner, name = repo.split("/")
        commits = fetch_commits(owner, name)
        prs = fetch_prs(owner, name)
        issues = fetch_issues(owner, name)
        repo_data[repo] = {"commits": commits, "prs": prs, "issues": issues}
        print(f"  {len(commits)} commits, {len(prs)} PRs, {len(issues)} issues")

    markdown = generate_markdown(notifications, repo_data)
    file_path = save_file(markdown)

    print(f"Saved to: {file_path}")
    print("GitHub sync complete")


if __name__ == "__main__":
    main()
