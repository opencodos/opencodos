# Notion Integration

> Create pages, search content, query databases, and manage workspace.

## Trigger

```
/notion [action] [args]
```

Examples:
- `/notion search "meeting notes"`
- `/notion create page "Project Plan" in "Projects"`
- `/notion query database "Tasks" --filter status=active`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" notion "[task description]"
```

Example for `/notion search`:
```bash
"Dev/Ops/mcp/run-mcp.sh" notion "Search Notion for pages containing 'meeting notes' using NOTION_SEARCH_NOTION_PAGE"
```

## MCP Server

`composio-notion` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

### Page Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `NOTION_CREATE_NOTION_PAGE` | Create new page | `parent_id`, `title`, `content` |
| `NOTION_SEARCH_NOTION_PAGE` | Find pages by title/query | `query` |
| `NOTION_UPDATE_PAGE` | Update page properties | `page_id`, `properties` |

### Content Fetching

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `NOTION_FETCH_ROW` | Get page METADATA (properties) | `page_id` |
| `NOTION_FETCH_BLOCK_CONTENTS` | Get page CONTENT (text, headings) | `block_id` |

### Database Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `NOTION_FETCH_DATA` | Query database rows | `database_id`, `filter` |
| `NOTION_INSERT_ROW_DATABASE` | Add row to database | `database_id`, `properties` |
| `NOTION_UPDATE_ROW_DATABASE` | Update database row | `page_id`, `properties` |

### Users

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `NOTION_LIST_USERS` | List workspace users | — |

## Important Distinction

**NOTION_FETCH_ROW** → Returns page **properties** (title, status, dates)
**NOTION_FETCH_BLOCK_CONTENTS** → Returns page **content** (actual text, headings, paragraphs)

To read a full page:
1. First get metadata with `NOTION_FETCH_ROW`
2. Then get content with `NOTION_FETCH_BLOCK_CONTENTS`

## Common Workflows

### Find and Read a Page

```
1. NOTION_SEARCH_NOTION_PAGE with query → get page_id
2. NOTION_FETCH_ROW for properties
3. NOTION_FETCH_BLOCK_CONTENTS for content
```

### Create New Page

```
1. Find parent page/database ID
2. NOTION_CREATE_NOTION_PAGE with parent_id, title, content
```

### Query Database

```
1. NOTION_FETCH_DATA with database_id and filter
2. Process returned rows
```

### Add Row to Database

```
1. NOTION_INSERT_ROW_DATABASE with database_id and properties
2. Properties must match database schema
```

## Database Filters

```json
{
  "property": "Status",
  "select": {
    "equals": "In Progress"
  }
}
```

Filter types: `equals`, `does_not_equal`, `contains`, `is_empty`, `is_not_empty`

## Notes

- Page IDs are UUIDs (32 chars), e.g., `26fe3ae5-...`
- Databases are special pages with rows
- Properties have types: title, text, select, multi_select, date, etc.
- Content is stored as blocks (paragraphs, headings, lists)

## Example: Fetch Notion Page

```
# Search returns UUID
NOTION_SEARCH_NOTION_PAGE(query="Project Planning")

# Get content using block_id (same as page_id)
NOTION_FETCH_BLOCK_CONTENTS(block_id="26fe3ae5-...")
```

**Important:** Only report data you actually received from tools. Never fabricate or hallucinate results. If a tool returns 2 items when you requested 7, report those 2 items and explain the API returned fewer results.

## Error Handling

| Issue | Action |
|-------|--------|
| Page not found | Search with different query |
| Database schema mismatch | Fetch database to check schema |
| Missing parent | Search for parent page first |
| Auth expired | Re-authenticate via Composio |
