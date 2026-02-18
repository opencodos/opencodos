# Known-Good MCP Commands

Use these read-only prompts to verify MCP connectivity per service.

| Service | Config | Prompt (safe read-only) |
|---|---|---|
| Calendar | `configs/mcp-calendar-only.json` | `Use GOOGLECALENDAR_LIST_CALENDARS. Return only names.` |
| Gmail | `configs/mcp-gmail-only.json` | `Use GMAIL_FETCH_EMAILS with ids_only=true and max_results=5. Return subject + id.` |
| Slack | `configs/mcp-slack-only.json` | `Use SLACK_LIST_ALL_USERS with limit=5. Return name + id.` |
| Linear | `configs/mcp-linear-only.json` | `Use LINEAR_LIST_LINEAR_ISSUES with first=5. Return title + id.` |
| Notion | `configs/mcp-notion-only.json` | `Use NOTION_SEARCH_NOTION_PAGE with query="meeting" and page_size=5. Return title + id.` |
| GitHub | `configs/mcp-github-only.json` | `Use GITHUB_LIST_REPOSITORIES_FOR_USER with username="yourusername" and per_page=5. Return name + url.` |
| Drive | `configs/mcp-gdrive-only.json` | `Use GOOGLEDRIVE_FIND_FILE with query="" and page_size=5. Return name + id.` |
| Docs | `configs/mcp-gdocs-only.json` | `Use GOOGLEDRIVE_FIND_FILE with query="" and page_size=5 to get a doc id, then GOOGLEDOCS_GET_DOCUMENT_BY_ID. Return title only.` |
| Sheets | `configs/mcp-gsheets-only.json` | `Use GOOGLESHEETS_SEARCH_SPREADSHEETS with query="" and page_size=5. Return name + id.` |

Example run:

```bash
"Dev/Ops/mcp/run-mcp.sh" gmail \
  "Use GMAIL_FETCH_EMAILS with ids_only=true and max_results=5. Return subject + id."
```
