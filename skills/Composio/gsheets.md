# Google Sheets Integration

> Read spreadsheets, lookup rows, add data, and search sheets.

## Trigger

```
/gsheets [action] [args]
```

Examples:
- `/gsheets read "Budget 2026"`
- `/gsheets lookup "Budget" where name="Q1"`
- `/gsheets add row "Expenses" ["item", "amount", "date"]`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" gsheets "[task description]"
```

Example for `/gsheets read`:
```bash
"Dev/Ops/mcp/run-mcp.sh" gsheets "Read data from Google Sheet 'Budget 2026' using GOOGLESHEETS_BATCH_GET"
```

## MCP Server

`composio-gsheets` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `GOOGLESHEETS_GET_SPREADSHEET_INFO` | Get sheet metadata | `spreadsheet_id` |
| `GOOGLESHEETS_BATCH_GET` | Read cell ranges | `spreadsheet_id`, `ranges` |
| `GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW` | Find row by criteria | `spreadsheet_id`, `lookup_column`, `lookup_value` |
| `GOOGLESHEETS_CREATE_SPREADSHEET_ROW` | Add new row | `spreadsheet_id`, `values`, `sheet_name` |
| `GOOGLESHEETS_SEARCH_SPREADSHEETS` | Search for spreadsheets | `query` |

## Finding Spreadsheets

Use search or Drive:
```
1. GOOGLESHEETS_SEARCH_SPREADSHEETS with query
2. Or GOOGLEDRIVE_FIND_FILE with spreadsheet mimeType
```

## Common Workflows

### Read Spreadsheet Data

```
1. GOOGLESHEETS_SEARCH_SPREADSHEETS to find sheet
2. GOOGLESHEETS_GET_SPREADSHEET_INFO for structure
3. GOOGLESHEETS_BATCH_GET for data ranges
```

### Lookup Specific Row

```
1. GOOGLESHEETS_LOOKUP_SPREADSHEET_ROW with column and value
2. Returns matching row data
```

### Add New Row

```
1. GOOGLESHEETS_GET_SPREADSHEET_INFO to verify columns
2. GOOGLESHEETS_CREATE_SPREADSHEET_ROW with values array
```

### Export as Table

```
1. GOOGLESHEETS_BATCH_GET with full range (e.g., "A1:Z100")
2. Format as markdown table
```

## Range Notation

| Range | Meaning |
|-------|---------|
| `Sheet1!A1:B10` | Specific range on Sheet1 |
| `A:A` | Entire column A |
| `1:1` | Entire row 1 |
| `Sheet1` | All data on Sheet1 |

## Spreadsheet Structure

- **Spreadsheet** = File containing sheets
- **Sheet** = Individual tab (Sheet1, Sheet2, etc.)
- **Range** = Cell selection (A1:C10)

## Notes

- Spreadsheet ID from URL: `docs.google.com/spreadsheets/d/{ID}/edit`
- First row often contains headers
- Values are returned as 2D array
- Empty cells may be omitted

## Error Handling

| Issue | Action |
|-------|--------|
| Sheet not found | List sheets with GET_SPREADSHEET_INFO |
| Range invalid | Check sheet name and dimensions |
| Row not found | Verify lookup column/value |
| Auth expired | Re-authenticate via Composio |
