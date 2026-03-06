---
name: qmd
description: Local semantic search across the Obsidian Vault. Use for finding what people said, past decisions, commitments, and context.
---

# QMD - Local Knowledge Search

> Semantic search engine for the Obsidian Vault. Combines BM25 keyword search, vector embeddings, and LLM reranking.

## When to Use

Use QMD when the user asks about:
- "What did [person] say about [topic]?"
- "Find mentions of [concept]"
- "Search for [keyword]"
- Past conversations, commitments, or relationships
- Context that might be in archived data

**Always query QMD before answering questions about history or relationships.**

## Available MCP Tools

| Tool | Use Case | Speed |
|------|----------|-------|
| `qmd_query` | Best quality - hybrid search + LLM reranking | Slower |
| `qmd_search` | Fast BM25 keyword search | Fast |
| `qmd_vsearch` | Semantic/conceptual search | Medium |
| `qmd_get` | Retrieve specific document by path | Instant |
| `qmd_status` | Check index health and stats | Instant |

## Which Tool to Use

```
User asks about exact phrase → qmd_search
User asks conceptual question → qmd_query
User asks "find documents like X" → qmd_vsearch
User references specific file → qmd_get
User asks "is search working?" → qmd_status
```

## Example Queries

### Finding what someone said
```
qmd_query("feedback on positioning from cofounder")
qmd_query("what did the client say about the deal")
qmd_query("comments on NDA from partner")
```

### Finding commitments and follow-ups
```
qmd_query("pending commitments promises unfulfilled")
qmd_query("stale conversations waiting response")
qmd_query("deadlines this week")
```

### Finding business context
```
qmd_query("deal pipeline revenue opportunities")
qmd_query("partnership discussions")
qmd_query("investor conversations")
```

### Finding relationship context
```
qmd_query("relationship concerns tensions blockers")
qmd_query("who introduced me to [person]")
qmd_query("last conversation with [person]")
```

## Integration with Skills

### Morning Brief (`/brief`)
Before generating, run these queries to surface hidden context:
```
qmd_query("pending commitments promises unfulfilled")
qmd_query("stale conversations waiting response 48h")
qmd_query("deals revenue pipeline opportunities")
qmd_query("relationship tensions concerns blockers")
```

### Profile Lookup (`/profile`)
When loading a person's context:
```
qmd_query("[person name] conversations mentions")
qmd_query("[person name] commitments promises")
```

### Call Prep (`/call-prep`)
Before a meeting:
```
qmd_query("[person] last discussed topics")
qmd_query("[person] open items pending")
qmd_query("[person] relationship history")
```

## Maintenance

### Refresh Index
Run periodically to index new vault content:
```bash
qmd embed
```

This downloads/updates embedding models (~3GB first time) and generates vectors for all documents.

### Check Status
```bash
qmd status
```

Shows:
- Number of indexed documents
- Collection info
- Last embed time
- Index health

### Manual Search (CLI)
```bash
qmd query "search term"
qmd search "exact phrase"
```

## How It Works

1. **BM25 Search** - Traditional keyword matching with TF-IDF scoring
2. **Vector Search** - Semantic similarity using embeddings
3. **Hybrid Fusion** - Combines both using Reciprocal Rank Fusion (RRF)
4. **LLM Reranking** - Final pass with small LLM to order by relevance

## Installation

If not installed, run:
```bash
bun install -g https://github.com/tobi/qmd
qmd collection add "/path/to/vault" --name vault
qmd embed
claude mcp add -s user qmd -- qmd mcp
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No results found" | Run `qmd embed` to refresh index |
| Slow queries | Normal for first query (loads models) |
| MCP not available | Run `claude mcp add -s user qmd -- qmd mcp` |
| Old content in results | Run `qmd embed` to reindex |

---

*Source: https://github.com/tobi/qmd*
