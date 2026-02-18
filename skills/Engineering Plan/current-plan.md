# Plan: Fix Missing Selected Chats in Telegram Config Modal

## Problem Summary

When opening the Telegram configuration modal, it shows "0 chats selected" even though chats have been previously selected and are actively being ingested. The available conversations list loads correctly, but none are pre-selected.

## Root Cause Analysis

**Data Flow Issue:**

1. **On Save**: Config is saved to BOTH:
   - Local storage (`workflowAPI.updateWorkflow`)
   - Backend (`integrationAPI.saveTelegramConfig` → `POST /telegram/config`)

2. **On Load**: Config is read ONLY from:
   - Local storage (`workflowAPI.get()` → `getWorkflows()`)

3. **The Disconnect**:
   - Backend stores the real workflow with `config.conversation_filters.include = [selected_ids]`
   - Frontend creates a LOCAL workflow with empty config when first connecting
   - Local storage starts fresh with `include: []` and never syncs from backend

**Evidence:**
- `ConnectorSettingsPage.tsx:145-148`: Fetches workflow from `workflowAPI.get()`
- `api.ts:676-682`: `workflowAPI.get()` reads from localStorage via `getWorkflows()`
- `TelegramConfigModal.tsx:40-43`: Reads `initialSelectedIds` from `workflowConfig.conversation_filters?.include`
- Backend has `GET /workflows` (line 37) and `GET /workflows/{id}` (line 181) endpoints that return config

## Solution

**Fetch workflow config from backend instead of localStorage.**

The backend's `/workflows` endpoint returns the workflow with its `config` field containing the selected conversation IDs. The frontend should:

1. Fetch workflows from backend API
2. Use the backend's config as the source of truth for selected conversations

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/api.ts` | Add `fetchFromBackend()` method to workflowAPI |
| `src/components/connectors/ConnectorSettingsPage.tsx` | Use backend workflows instead of localStorage |

## Implementation Details

### Option A: Hybrid Approach (Recommended)

Fetch from backend first, fallback to localStorage if backend unavailable.

**File: `src/lib/api.ts`**

Add a method to fetch workflows from backend:

```typescript
export const workflowAPI = {
  // Existing local methods...

  async fetchFromBackend(): Promise<Workflow[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/workflows`)
      if (!response.ok) {
        console.warn('Failed to fetch workflows from backend, using local storage')
        return getWorkflows()
      }
      const workflows = await response.json() as Workflow[]
      // Sync to local storage
      setWorkflows(workflows)
      return workflows
    } catch (error) {
      console.warn('Backend unavailable, using local storage:', error)
      return getWorkflows()
    }
  },

  async getFromBackend(id: number): Promise<Workflow | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/workflows/${id}`)
      if (!response.ok) return null
      return await response.json() as Workflow
    } catch {
      return null
    }
  },
}
```

**File: `src/components/connectors/ConnectorSettingsPage.tsx`**

Update `fetchWorkflow()` to use backend:

```typescript
const fetchWorkflow = useCallback(
  async (skipCache = false) => {
    try {
      // ... cache check logic ...

      // CHANGED: Fetch from backend instead of local storage
      const workflows = await workflowAPI.fetchFromBackend()
      let serviceWorkflow = workflows.find((w) =>
        w.name.toLowerCase().includes(`${service} ingestion`),
      );

      // ... rest of the logic stays the same ...
    } catch (err) {
      console.error('Error fetching workflow:', err);
    }
  },
  [service],
);
```

Also update `openWorkflowModal()` to refresh from backend:

```typescript
const openWorkflowModal = async () => {
  if (workflow) {
    // CHANGED: Fetch from backend to get latest config
    const fullWorkflow = await workflowAPI.getFromBackend(workflow.id);
    if (fullWorkflow) {
      setWorkflow(fullWorkflow);
    }
  }
  setShowWorkflowModal(true);
};
```

### Option B: Backend-Only (Simpler but less resilient)

Replace all localStorage workflow reads with backend API calls. Less code but no offline fallback.

## Verification Steps

1. Open browser DevTools → Network tab
2. Navigate to Telegram → Settings → Edit
3. Verify `GET /workflows` is called
4. Check response contains `config.conversation_filters.include` with selected IDs
5. Modal should show previously selected chats as checked

## Risks

| Risk | Mitigation |
|------|------------|
| Backend unavailable | Fallback to localStorage (Option A) |
| Auth token missing | Ensure auth header is included in fetch |
| Config format mismatch | Backend uses same schema, verified in `mc_domain/schemas.py` |

## Questions

1. Should we keep local storage sync as cache, or remove it entirely?
2. Is there authentication required for `/workflows` endpoint? (Need to check if API_BASE_URL includes auth)
