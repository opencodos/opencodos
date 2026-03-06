# Plan: Fix Connector Status Display

## Problem Analysis

### Current State
- Only **Granola** shows as connected (checks local file: `~/Library/Application Support/Granola/supabase.json`)
- All MCP-based connectors (Slack, Gmail, Notion, etc.) show as disconnected
- Backend uses `run-mcp.sh` which spawns full Claude CLI process per service - too slow/heavy

### Root Cause
1. **MCP status check approach is broken**: Running `claude --print` with MCP commands takes 30+ seconds per service and often times out
2. **Only 1 Composio connection exists**: Tested Composio API - only **Google Calendar** is actually connected with `ACTIVE` status
3. Other services (Slack, Gmail, Notion, Linear, GitHub) have **no Composio connected accounts**

### Composio API Test Results
```
Total connected accounts: 1
  - googlecalendar: ACTIVE
```

## Solution: Use Composio REST API Directly

Replace the heavy MCP-based status checks with direct Composio API calls.

### Composio API Endpoint
```
GET https://backend.composio.dev/api/v3/connected_accounts
Headers: x-api-key: <COMPOSIO_API_KEY>
```

Returns connected accounts with their status (`ACTIVE`, `EXPIRED`, `FAILED`, etc.)

## Implementation Steps

### Phase 1: Update Backend Status Checker

Modify the connector-ui backend `status_checker.py`:

1. Add Composio API integration:
   - Load `COMPOSIO_API_KEY` from env or secrets file
   - Make async HTTP call to Composio API
   - Parse response to map toolkit slugs to connection status

2. Service mapping (Composio toolkit slugs):
   - `slack` → `slack`
   - `gmail` → `gmail`
   - `googlecalendar` → `googlecalendar`
   - `notion` → `notion`
   - `linear` → `linear`
   - `github` → `github`
   - `googledrive` → `googledrive`
   - `googledocs` → `googledocs`

3. Keep special handlers for:
   - **Granola**: Local file check (already works)
   - **Telegram**: Local agent check at `localhost:8768` (already works)

### Phase 2: Add Missing Connections

For services that should be connected but aren't, user needs to:
1. Go to Composio dashboard or run OAuth flow
2. Connect each service (Slack, Gmail, Notion, etc.)

OR we can add "Connect" buttons that redirect to Composio OAuth.

## Files to Modify

| File | Change |
|------|--------|
| `backend/status_checker.py` | Replace `check_mcp_service_status()` with Composio API call |
| `backend/.env` (create) | Add `COMPOSIO_API_KEY` |

## Technical Approach

```python
# New status checker using Composio API
async def check_composio_services() -> dict[str, ServiceStatus]:
    """Check all Composio-connected services via REST API."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://backend.composio.dev/api/v3/connected_accounts",
            headers={"x-api-key": COMPOSIO_API_KEY},
            params={"limit": 50}
        )
        data = response.json()

        status_map = {}
        for item in data.get("items", []):
            toolkit = item["toolkit"]["slug"]
            status = item["status"]
            status_map[toolkit] = ServiceStatus(
                connected=(status == "ACTIVE"),
                status=status.lower(),
                account_id=item.get("id"),
            )
        return status_map
```

## Benefits

1. **Fast**: Single API call vs 8+ separate Claude CLI processes
2. **Reliable**: Direct API check vs parsing CLI output
3. **Accurate**: Shows actual Composio connection state
4. **Lightweight**: No subprocess spawning

## Success Criteria

- [ ] Backend returns accurate status for all services in <2 seconds
- [ ] Google Calendar shows as connected (it's ACTIVE in Composio)
- [ ] Other services show as disconnected until OAuth is completed
- [ ] Granola and Telegram continue working via existing checks
