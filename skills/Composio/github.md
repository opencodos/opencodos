# GitHub Integration

> List commits, search repos, view PRs, and manage issues.

## Trigger

```
/github [action] [args]
```

Examples:
- `/github commits myorg/myrepo`
- `/github repos yourusername`
- `/github search "composio MCP"`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" github "[task description]"
```

Example for `/github commits`:
```bash
"Dev/Ops/mcp/run-mcp.sh" github "List recent commits for myorg/myrepo using GITHUB_LIST_COMMITS"
```

## MCP Server

`composio-github` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GITHUB_LIST_COMMITS` | List repo commits | `owner`, `repo`, `sha`, `per_page` |
| `GITHUB_GET_A_REPOSITORY` | Get repo details | `owner`, `repo` |
| `GITHUB_LIST_REPOSITORIES_FOR_USER` | List user's repos | `username`, `sort`, `per_page` |
| `GITHUB_SEARCH_REPOSITORIES` | Search repos globally | `q` (query) |

## Common Workflows

### Check Recent Commits

```
1. GITHUB_LIST_COMMITS with owner, repo
2. Format commit list with dates and messages
```

### Find a Repository

```
1. GITHUB_SEARCH_REPOSITORIES with query
2. Or GITHUB_LIST_REPOSITORIES_FOR_USER for specific user
```

### Get Repo Overview

```
1. GITHUB_GET_A_REPOSITORY for metadata
2. GITHUB_LIST_COMMITS for recent activity
```

## Search Query Syntax

| Query | Example |
|-------|---------|
| By language | `language:typescript` |
| By user/org | `user:myorg` or `org:anthropics` |
| By topic | `topic:mcp` |
| By stars | `stars:>100` |
| Combined | `composio language:python stars:>10` |

## Repository Fields

| Field | Description |
|-------|-------------|
| `full_name` | owner/repo |
| `description` | Repo description |
| `stargazers_count` | Star count |
| `default_branch` | Main branch name |
| `pushed_at` | Last push timestamp |

## Notes

- Commits return last 30 by default
- Private repos require proper OAuth scope
- Search is rate-limited (30 req/min unauthenticated)
- Use `sha` param to list commits from specific branch

## Error Handling

| Issue | Action |
|-------|--------|
| Repo not found | Check owner/repo spelling |
| Rate limited | Wait or authenticate |
| Private repo access | Verify OAuth scopes |
| Auth expired | Re-authenticate via Composio |
