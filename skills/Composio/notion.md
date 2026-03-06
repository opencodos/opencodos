# Notion Integration

> Search pages, fetch content, create and update pages, manage databases, and organize workspace.

## Trigger

```
/notion [action] [args]
```

Examples:
- `/notion search "meeting notes"`
- `/notion create page "Project Plan" in "Projects"`
- `/notion get page "Weekly Standup"`

## Execution

Notion tools are available directly via the Official Notion MCP (claude.ai Connectors). No wrapper script needed.

**Tool prefix:** `mcp__claude_ai_Notion__notion-*`

## Available Tools

### Search & Fetch

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `notion-search` | Search workspace content | `query` (min 1 char) |
| `notion-fetch` | Get page content + metadata (returns markdown) | page URL or ID |

### Page Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `notion-create-pages` | Create new pages | parent, title, content |
| `notion-update-page` | Modify page properties | page ID, properties |
| `notion-move-pages` | Move pages to new parent | page IDs, target |
| `notion-duplicate-page` | Duplicate a page | page ID |

### Database Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `notion-create-database` | Create a new database | parent, schema |
| `notion-update-data-source` | Update database schema | database ID, schema |

### Comments

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `notion-create-comment` | Add comment to a page | page ID, text |
| `notion-get-comments` | Retrieve comments on a page | page ID |

### Workspace

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `notion-get-teams` | List teamspaces | -- |
| `notion-get-users` | List workspace users | -- |

## Common Workflows

### Find and Read a Page

```
1. notion-search with query -> get page URL/ID
2. notion-fetch to get full content as markdown
```

### Create New Page

```
1. notion-search to find parent page/database
2. notion-create-pages with parent, title, content
```

### Update Page Properties

```
1. notion-search or notion-fetch to find the page
2. notion-update-page with page ID and new properties
```

### Query Database

```
1. notion-search to find the database
2. notion-fetch to get database contents
```

## Notes

- `notion-search` requires a query string (minimum 1 character)
- `notion-fetch` returns content as markdown -- no need for separate metadata/content calls
- Page IDs are UUIDs (32 chars), e.g., `26fe3ae5-...`
- Databases are special pages with structured rows
- Tools are auto-discovered from claude.ai Connectors -- no setup needed beyond initial OAuth
- Use `ToolSearch` to discover exact tool names if needed

**Important:** Only report data you actually received from tools. Never fabricate or hallucinate results. If a tool returns fewer items than expected, report what you got and explain.

## Error Handling

| Issue | Action |
|-------|--------|
| Page not found | Search with different query |
| Database schema mismatch | Fetch database to check schema first |
| Missing parent | Search for parent page first |
| Tools not available | Check claude.ai Settings -> Connectors -> Notion is connected |
