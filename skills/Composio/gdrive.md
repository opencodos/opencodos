# Google Drive Integration

> Search files, download content, list folders, and upload files.

## Trigger

```
/gdrive [action] [args]
```

Examples:
- `/gdrive search "Q4 report"`
- `/gdrive list "Projects" folder`
- `/gdrive download file_id`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" gdrive "[task description]"
```

Example for `/gdrive search`:
```bash
"Dev/Ops/mcp/run-mcp.sh" gdrive "Search Google Drive for files matching 'Q4 report' using GOOGLEDRIVE_FIND_FILE"
```

## MCP Server

`composio-gdrive` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GOOGLEDRIVE_FIND_FILE` | Search files with query | `query`, `mime_type` |
| `GOOGLEDRIVE_LIST_FILES` | List files in Drive/folder | `folder_id`, `page_size` |
| `GOOGLEDRIVE_DOWNLOAD_FILE` | Get file content | `file_id`, `mime_type` |
| `GOOGLEDRIVE_GET_FILE_BY_ID` | Get file metadata | `file_id` |
| `GOOGLEDRIVE_CREATE_FILE` | Upload new file | `name`, `content`, `mime_type`, `folder_id` |

## Common Workflows

### Find a Document

```
1. GOOGLEDRIVE_FIND_FILE with search query
2. Use mimeType filter for specific types
3. GOOGLEDRIVE_DOWNLOAD_FILE to get content
```

### List Folder Contents

```
1. GOOGLEDRIVE_FIND_FILE to find folder by name
2. GOOGLEDRIVE_LIST_FILES with folder_id
```

### Read File Content

```
1. GOOGLEDRIVE_GET_FILE_BY_ID for metadata
2. For Google Docs/Sheets/Slides: Use native APIs (GOOGLEDOCS_GET_DOCUMENT_BY_ID, etc.)
3. For binary files: GOOGLEDRIVE_DOWNLOAD_FILE
```

**Warning:** `GOOGLEDRIVE_DOWNLOAD_FILE` saves to container path, not returns content inline. For Google Docs, always use `GOOGLEDOCS_GET_DOCUMENT_BY_ID` instead.

## Search Query Syntax

| Query | Example |
|-------|---------|
| By name | `name contains 'report'` |
| By type | `mimeType = 'application/vnd.google-apps.document'` |
| By folder | `'folder_id' in parents` |
| Full text | `fullText contains 'budget'` |
| Modified | `modifiedTime > '2026-01-01'` |

## MIME Types

| Type | MIME |
|------|------|
| Google Doc | `application/vnd.google-apps.document` |
| Google Sheet | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Folder | `application/vnd.google-apps.folder` |
| PDF | `application/pdf` |

## Export Formats

When downloading Google Docs, specify export format:
- `text/plain` — Plain text
- `application/pdf` — PDF
- `text/html` — HTML

## Notes

- File IDs are long alphanumeric strings
- "My Drive" is the root folder
- Shared files may have different access levels
- Folders are files with special mimeType

## Error Handling

| Issue | Action |
|-------|--------|
| File not found | Search with different query |
| Access denied | Check sharing permissions |
| Folder empty | Verify folder_id is correct |
| Auth expired | Re-authenticate via Composio |
