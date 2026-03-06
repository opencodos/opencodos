#!/usr/bin/env python3
"""Parallel Research - Deep AI research via Parallel AI API."""

import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

API_URL = "https://api.parallel.ai/v1/tasks/runs"


def research(query: str, processor: str = "pro", timeout: int = 1800) -> str:
    """Run research and return markdown content."""
    api_key = os.environ.get("PARALLEL_API_KEY")
    if not api_key:
        sys.exit("Error: PARALLEL_API_KEY not set")

    # Start task
    resp = requests.post(
        API_URL,
        headers={"x-api-key": api_key, "Content-Type": "application/json"},
        json={"input": query, "processor": processor, "task_spec": {"output_schema": {"type": "text"}}},
    )
    resp.raise_for_status()
    run_id = resp.json()["run_id"]
    print(f"Started: {run_id}")

    # Poll until done
    start = time.time()
    while time.time() - start < timeout:
        status = requests.get(f"{API_URL}/{run_id}", headers={"x-api-key": api_key}).json()
        if status["status"] == "completed":
            break
        if status["status"] == "failed":
            sys.exit(f"Failed: {status.get('error', 'unknown')}")
        print(".", end="", flush=True)
        time.sleep(15)
    else:
        sys.exit("Timeout")

    # Get result
    result = requests.get(f"{API_URL}/{run_id}/result", headers={"x-api-key": api_key}).json()
    content = result.get("output", {}).get("content", "")
    return content if isinstance(content, str) else content.get("text", str(content))


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: parallel-research.py 'query' [output.md]")

    query = sys.argv[1]
    vault = os.environ.get("VAULT_PATH", os.path.expanduser("~/projects/Vault"))
    slug = re.sub(r"[^\w\s-]", "", query.lower())[:40].strip().replace(" ", "-")
    output = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else Path(vault) / "2 - Projects/Research" / f"{datetime.now():%Y-%m-%d}-{slug}.md"
    )

    print(f"Query: {query}")
    print(f"Output: {output}")

    content = research(query)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f"---\nquery: {query}\ndate: {datetime.now():%Y-%m-%d}\n---\n\n{content}\n")

    print(f"\nSaved: {output}")
    print(content[:300] + "..." if len(content) > 300 else content)


if __name__ == "__main__":
    main()
