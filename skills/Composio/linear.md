# Linear Integration

> Create issues, track tasks, list projects, and manage sprints.

## Trigger

```
/linear [action] [args]
```

Examples:
- `/linear create "Fix login bug" --team Engineering`
- `/linear list --assignee me`
- `/linear update ABC-123 --status "In Progress"`

## Execution (Wrapper)

Use the MCP wrapper to load only the needed server:

```bash
"Dev/Ops/mcp/run-mcp.sh" linear "[task description]"
```

Example for `/linear list`:
```bash
"Dev/Ops/mcp/run-mcp.sh" linear "List my assigned Linear issues using LINEAR_LIST_LINEAR_ISSUES"
```

## MCP Server

`composio-linear` — HTTP transport via Composio (loaded in ~/atlas-mcp)

## Critical Tools (Always Available)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `LINEAR_CREATE_LINEAR_ISSUE` | Create new issue | `title`, `description`, `team_id`, `assignee_id` |
| `LINEAR_LIST_LINEAR_ISSUES` | List/filter issues | `filter`, `first` |
| `LINEAR_GET_LINEAR_ISSUE` | Get issue details | `issue_id` |
| `LINEAR_UPDATE_ISSUE` | Update issue | `issue_id`, `title`, `state_id`, `assignee_id` |
| `LINEAR_LIST_LINEAR_USERS` | List team members | `first` |
| `LINEAR_LIST_LINEAR_TEAMS` | List all teams | — |
| `LINEAR_LIST_LINEAR_PROJECTS` | List projects | `first` |

## Common Workflows

### Create Issue

```
1. LINEAR_LIST_LINEAR_TEAMS to find team ID
2. LINEAR_LIST_LINEAR_USERS to find assignee (optional)
3. LINEAR_CREATE_LINEAR_ISSUE with title, description, team_id
```

### Check My Tasks

```
LINEAR_LIST_LINEAR_ISSUES(
  limit=20,
  order_by="updatedAt"  # Get most recently updated first
)
# For specific issue details:
LINEAR_GET_LINEAR_ISSUE(issue_id="ABC-123")
```
Group results by status/priority.

### Update Issue Status

```
1. LINEAR_GET_LINEAR_ISSUE to verify current state
2. LINEAR_UPDATE_ISSUE with new state_id
```

### Review Team Backlog

```
1. LINEAR_LIST_LINEAR_TEAMS to get team ID
2. LINEAR_LIST_LINEAR_ISSUES filtered by team
```

## Issue Filters

| Filter | Example |
|--------|---------|
| By assignee | `assignee: { id: { eq: "user_id" } }` |
| By team | `team: { id: { eq: "team_id" } }` |
| By state | `state: { name: { eq: "In Progress" } }` |
| By priority | `priority: { gte: 2 }` |

## States (Common)

| State | Meaning |
|-------|---------|
| Backlog | Not started |
| Todo | Ready to work |
| In Progress | Active work |
| In Review | PR/Review stage |
| Done | Completed |
| Canceled | Won't do |

## Notes

- Issue IDs look like `ABC-123`
- Teams have workflows (custom states)
- Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
- Labels and projects are optional

## Error Handling

| Issue | Action |
|-------|--------|
| Team not found | List teams and pick |
| User not found | List users and pick |
| Invalid state | Get team workflow states |
| Auth expired | Re-authenticate via Composio |
