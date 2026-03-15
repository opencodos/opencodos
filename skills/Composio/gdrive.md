# Google Drive Integration

> Search files, list folders, download content, and manage files via Google Drive.

## Trigger

```
/gdrive [action] [args]
```

Examples:
- `/gdrive search "meeting notes"`
- `/gdrive list folder "Project Files"`
- `/gdrive download <fileId>`

## Execution

Drive tools are available directly via the Official Google Drive MCP (claude.ai Connectors). No wrapper script needed.

**Tool prefix:** `mcp__claude_ai_Google_Drive__*`

## Available Tools

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `drive_search` | Full-text search across Drive | `query` |
| `drive_list` | List files in a folder | `folderId` |
| `drive_get_file` | Get file metadata | `fileId` |
| `drive_download` | Download a file | `fileId` |
| `drive_upload` | Upload a file | `file`, `folderId` |

> **Note:** Exact tool names are placeholders — use `ToolSearch` for "drive" to discover actual tool names after enabling the connector. Upload capability depends on what the native MCP exposes.

## Drive Search Query Syntax

| Query | Example |
|-------|---------|
| By name | `name contains 'report'` |
| By type | `mimeType = 'application/vnd.google-apps.document'` |
| By folder | `'<folderId>' in parents` |
| Full text | `fullText contains 'budget'` |
| Modified after | `modifiedTime > '2026-01-01'` |
| Combine | `name contains 'Q4' and mimeType = 'application/pdf'` |

## MIME Types

| Type | MIME |
|------|------|
| Google Doc | `application/vnd.google-apps.document` |
| Google Sheet | `application/vnd.google-apps.spreadsheet` |
| Google Slides | `application/vnd.google-apps.presentation` |
| Folder | `application/vnd.google-apps.folder` |
| PDF | `application/pdf` |

## Common Workflows

### Find and Read a Document

```
1. drive_search with query "meeting notes"
2. drive_get_file for metadata
3. drive_download to get content
```

### Upload a File

```
1. drive_upload with file path and optional folderId
```

## Notes

- File IDs are long alphanumeric strings from the URL
- Tools are auto-discovered from claude.ai Connectors — no setup needed beyond initial OAuth
- Use `ToolSearch` to discover exact tool names if needed

## Error Handling

| Issue | Action |
|-------|--------|
| File not found | Search with different query |
| Download fails | Check file permissions |
| Tools not available | Check claude.ai Settings → Connectors → Google Drive is connected |
