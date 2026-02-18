# Google Docs Integration

> Read documents, create new docs, and insert/edit text.

## Trigger

```
/gdocs [action] [args]
```

Examples:
- `/gdocs read "Meeting Notes"`
- `/gdocs create "New Document"`
- `/gdocs append doc_id "New section content"`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" gdocs "[task description]"
```

Example for `/gdocs read`:
```bash
"Dev/Ops/mcp/run-mcp.sh" gdocs "Get the content of Google Doc with ID 'abc123' using GOOGLEDOCS_GET_DOCUMENT_BY_ID"
```

## MCP Server

`composio-gdocs` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GOOGLEDOCS_GET_DOCUMENT_BY_ID` | Get document content | `document_id` |
| `GOOGLEDOCS_CREATE_DOCUMENT` | Create new document | `title` |
| `GOOGLEDOCS_INSERT_TEXT_ACTION` | Insert text into doc | `document_id`, `text`, `index` |

## Finding Documents (Three-Step Approach)

**Note:** Google Docs doesn't have a native search. Use Google Drive instead:

```
# Step 1: Find docs via Google DRIVE API (returns file metadata + IDs)
GOOGLEDRIVE_FIND_FILE(
  q="mimeType='application/vnd.google-apps.document'",
  orderBy="modifiedTime desc",
  pageSize=10
)

# Step 2: Get actual CONTENT via Google DOCS API (returns text inline)
GOOGLEDOCS_GET_DOCUMENT_BY_ID(document_id="1abc...")

# ⚠️ Do NOT use GOOGLEDRIVE_DOWNLOAD_FILE - it saves to container path, not returns content!
```

Query for docs only:
```
mimeType = 'application/vnd.google-apps.document' and name contains 'query'
```

## Common Workflows

### Read a Document

```
1. GOOGLEDRIVE_FIND_FILE to search by name (with doc mimeType)
2. GOOGLEDOCS_GET_DOCUMENT_BY_ID with returned file ID
```

### Create New Document

```
1. GOOGLEDOCS_CREATE_DOCUMENT with title
2. GOOGLEDOCS_INSERT_TEXT_ACTION to add content
```

### Add Content to Existing Doc

```
1. GOOGLEDOCS_GET_DOCUMENT_BY_ID to find end index
2. GOOGLEDOCS_INSERT_TEXT_ACTION at end position
```

## Document Structure

Google Docs returns content as structured elements:
- `paragraph` — Text paragraphs
- `table` — Tables
- `sectionBreak` — Page/section breaks
- `tableOfContents` — TOC element

## Insert Index

- `index: 1` — Insert at beginning
- `index: -1` or end of content — Insert at end
- Content shifts after insertion point

## Notes

- Document IDs are from the URL: `docs.google.com/document/d/{ID}/edit`
- New docs are created in My Drive root
- Use Drive API to move docs to folders
- Rich formatting requires multiple API calls

## Error Handling

| Issue | Action |
|-------|--------|
| Doc not found | Use Drive search to find ID |
| Invalid index | Get doc to find valid range |
| Permission denied | Check doc sharing settings |
| Auth expired | Re-authenticate via Composio |
