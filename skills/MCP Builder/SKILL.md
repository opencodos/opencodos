---
name: mcp-builder
description: Build MCP servers for LLM integrations. Use when creating tools that connect Claude to external services.
---

# MCP Builder

> Create Model Context Protocol servers that enable LLMs to interact with external services.

## Trigger

`/mcp-builder` or "build an MCP server" or "create MCP integration"

## Four-Phase Process

### Phase 1: Research & Planning

**Design Principles:**
- Balance API coverage with specialized workflow tools
- Use action-oriented tool naming: `github_create_issue`, `slack_send_message`
- Return focused, relevant data with pagination
- Provide actionable error messages with next steps

**Documentation:**
```bash
# MCP specification
curl https://modelcontextprotocol.io/sitemap.xml

# Fetch spec pages as markdown
curl https://modelcontextprotocol.io/docs/concepts/tools.md
```

**Stack Recommendation:**
- Language: TypeScript (superior SDK, static typing)
- Transport: Streamable HTTP (remote) or stdio (local)

### Phase 2: Implementation

**Project Structure (TypeScript):**
```
my-mcp-server/
├── src/
│   ├── index.ts          # Entry point
│   ├── tools/            # Tool implementations
│   │   ├── create.ts
│   │   ├── read.ts
│   │   └── index.ts
│   ├── client.ts         # API client
│   └── types.ts          # Type definitions
├── package.json
└── tsconfig.json
```

**Basic Server Setup:**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "my-service",
  version: "1.0.0",
});

// Register tools
server.tool(
  "service_action",
  "Description of what this tool does",
  {
    param1: z.string().describe("What this param is for"),
    param2: z.number().optional().describe("Optional param"),
  },
  async ({ param1, param2 }) => {
    const result = await apiClient.doAction(param1, param2);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Tool Annotations:**
```typescript
server.tool(
  "dangerous_delete",
  "Delete a resource permanently",
  { id: z.string() },
  async ({ id }) => { /* ... */ },
  {
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    }
  }
);
```

**Input Validation with Zod:**
```typescript
import { z } from "zod";

const CreateIssueSchema = z.object({
  title: z.string().min(1).describe("Issue title"),
  body: z.string().optional().describe("Issue description"),
  labels: z.array(z.string()).optional().describe("Labels to apply"),
  assignees: z.array(z.string()).optional().describe("Users to assign"),
});
```

**Error Handling:**
```typescript
server.tool("api_action", "...", schema, async (params) => {
  try {
    const result = await apiCall(params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (error) {
    if (error.status === 404) {
      return {
        content: [{
          type: "text",
          text: `Resource not found. Try listing available resources first with list_resources tool.`
        }],
        isError: true,
      };
    }
    throw error;
  }
});
```

**Pagination Support:**
```typescript
server.tool(
  "list_items",
  "List items with pagination",
  {
    page: z.number().default(1),
    per_page: z.number().default(20).max(100),
  },
  async ({ page, per_page }) => {
    const { items, total } = await api.list({ page, per_page });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          items,
          pagination: {
            page,
            per_page,
            total,
            has_more: page * per_page < total,
          }
        }, null, 2)
      }]
    };
  }
);
```

### Phase 3: Testing

**Build Verification:**
```bash
# TypeScript
npm run build

# Python
python -m py_compile src/server.py
```

**Test with MCP Inspector:**
```bash
npx @anthropic/mcp-inspector
```

**Manual Testing:**
```bash
# Start server
node dist/index.js

# In another terminal, send test request
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### Phase 4: Evaluations

Create 10 test questions:
- Require multiple tool calls
- Read-only operations only
- Independently verifiable
- Stable over time

```xml
<evaluation>
  <qa_pair id="1">
    <question>List all open issues in the repo and count them</question>
    <answer>There are 15 open issues</answer>
  </qa_pair>
</evaluation>
```

## Python Alternative (FastMCP)

```python
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

mcp = FastMCP("my-service")

class CreateItemInput(BaseModel):
    name: str = Field(description="Item name")
    description: str | None = Field(default=None, description="Optional description")

@mcp.tool()
async def create_item(input: CreateItemInput) -> str:
    """Create a new item in the service."""
    result = await api.create(input.name, input.description)
    return f"Created item: {result.id}"

@mcp.tool()
async def list_items(page: int = 1, limit: int = 20) -> str:
    """List all items with pagination."""
    items = await api.list(page=page, limit=limit)
    return json.dumps(items, indent=2)

if __name__ == "__main__":
    mcp.run()
```

## Tool Naming Conventions

| Pattern | Example | Use Case |
|---------|---------|----------|
| `{service}_{action}_{resource}` | `github_create_issue` | Standard CRUD |
| `{service}_{verb}` | `slack_send_message` | Simple actions |
| `{service}_{workflow}` | `jira_triage_ticket` | Complex workflows |

## Response Formatting

```typescript
// Structured for LLM consumption
return {
  content: [{
    type: "text",
    text: `## Results

**Found ${items.length} items**

| Name | Status | Created |
|------|--------|---------|
${items.map(i => `| ${i.name} | ${i.status} | ${i.created} |`).join('\n')}

*Page ${page} of ${totalPages}*`
  }]
};
```

## Installation

```bash
# Create project
mkdir my-mcp-server && cd my-mcp-server
npm init -y
npm install @modelcontextprotocol/sdk zod

# TypeScript setup
npm install -D typescript @types/node
npx tsc --init
```

## package.json

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Source

Based on Anthropic's mcp-builder skill.
