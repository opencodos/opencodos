---
name: parallel-research
description: Deep AI research via Parallel AI. Use for comprehensive multi-source research with citations.
---

# Parallel Research

> AI research agent that synthesizes 20+ sources into analyst-grade reports.

## Trigger

`/parallel-research [topic]`

## Usage

```bash
python3 parallel-research.py "Your research question"
```

Requires `PARALLEL_API_KEY` in the secrets backend.

Optional: specify output path as second argument.

## When to Use

| Need | Tool |
|------|------|
| 20+ sources, citations, 5-15 min wait | Parallel Research |
| Quick lookup, 2-3 sources | WebSearch |

## Output

Saves to `Vault/2 - Projects/Research/{date}-{slug}.md`

## API

- Endpoint: `https://api.parallel.ai/v1/tasks/runs`
- Auth: `PARALLEL_API_KEY` env var
- Docs: https://docs.parallel.ai
