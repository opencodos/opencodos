#!/usr/bin/env python3
"""Generate CRM Dashboard markdown from contacts.yaml."""

import os
from datetime import datetime
from pathlib import Path

import yaml

VAULT_PATH = Path(os.environ.get("VAULT_PATH", ""))
CRM_FILE = VAULT_PATH / "4 - CRM/contacts.yaml"
DASHBOARD_FILE = VAULT_PATH / "4 - CRM/CRM Dashboard.md"


def generate_dashboard():
    """Generate readable CRM dashboard."""
    with open(CRM_FILE) as f:
        crm = yaml.safe_load(f)

    contacts = crm.get("contacts", [])
    metadata = crm.get("metadata", {})

    # Group by relationship tier
    tiers = {
        "5 - Very close": [],
        "4 - Close": [],
        "3 - Close enough": [],
        "2 - Warmish": [],
        "1 - New connection": [],
        "0 - Can get intro": [],
    }

    for c in contacts:
        rel = c.get("relationship", "1 - New connection")
        if rel in tiers:
            tiers[rel].append(c)
        else:
            tiers["1 - New connection"].append(c)

    # Build markdown
    last_updated = metadata.get("last_updated")
    if isinstance(last_updated, datetime):
        last_updated_str = last_updated.strftime("%Y-%m-%d %H:%M")
        last_updated_short = last_updated.strftime("%Y-%m-%d")
    elif last_updated:
        last_updated_str = str(last_updated)
        last_updated_short = str(last_updated)[:10]
    else:
        last_updated_str = "N/A"
        last_updated_short = "Never"

    lines = [
        "---",
        f"updated: {last_updated_str}",
        f"total_contacts: {len(contacts)}",
        "---",
        "",
        "# CRM Dashboard",
        "",
        f"> Last updated: {last_updated_short}",
        f"> Total contacts: {len(contacts)}",
        "",
    ]

    # Action items section
    action_items = [c for c in contacts if c.get("next_step") and "None" not in str(c.get("next_step", ""))]
    if action_items:
        lines.append("## 🎯 Action Items")
        lines.append("")
        lines.append("| Contact | Next Step | Last Contact |")
        lines.append("|---------|-----------|--------------|")
        for c in action_items[:15]:
            name = c.get("name", "Unknown")
            step = c.get("next_step", "")[:50]
            last = c.get("last_connection", "—")
            lines.append(f"| {name} | {step} | {last} |")
        lines.append("")

    # Contacts by tier
    for tier_name, tier_contacts in tiers.items():
        if not tier_contacts:
            continue

        emoji = {"5": "🔥", "4": "⭐", "3": "👤", "2": "🌱", "1": "🆕", "0": "🔗"}.get(tier_name[0], "")
        lines.append(f"## {emoji} {tier_name}")
        lines.append("")
        lines.append("| Name | Company | Last Contact | Last Message | Next Step |")
        lines.append("|------|---------|--------------|--------------|-----------|")

        for c in sorted(tier_contacts, key=lambda x: str(x.get("last_connection") or ""), reverse=True):
            name = c.get("name", "Unknown")
            company = c.get("company") or "—"
            last_contact = c.get("last_connection") or "—"

            last_msg = c.get("last_messages", {})
            them_msg = last_msg.get("them", "")
            if them_msg:
                them_msg = them_msg[:40].replace("|", "/").replace("\n", " ")
            else:
                them_msg = "—"

            next_step = c.get("next_step") or "—"
            if len(next_step) > 40:
                next_step = next_step[:40] + "..."
            next_step = next_step.replace("|", "/")

            lines.append(f"| {name} | {company} | {last_contact} | {them_msg} | {next_step} |")

        lines.append("")

    # Write dashboard
    DASHBOARD_FILE.write_text("\n".join(lines))
    print(f"Dashboard generated: {DASHBOARD_FILE}")


if __name__ == "__main__":
    generate_dashboard()
