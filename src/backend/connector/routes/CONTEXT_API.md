# Context API Documentation

This router provides context data from the Obsidian Vault for the ContextPanel component.

## Endpoints

### 1. GET /api/context
Returns full context (memory + today + learnings).

**Response:**
```json
{
  "memory": {
    "name": "DK",
    "timezone": "Madrid",
    "location": "Barcelona",
    "goals": [
      ""
    ],
    "preferences": {
      "Tone": "Direct, concise, no fluff",
      "Format": "Tables > bullets > prose",
      "Length": "Short by default, expand on request",
      "Vibe": "Casual but competent"
    }
  },
  "today": {
    "morning_brief_time": "Tuesday, 2026-01-27",
    "todos": {
      "total": 30,
      "completed": 22,
      "pending": 8
    },
    "next_calls": [
      {
        "time": "16:00",
        "title": "RL",
        "context": null
      },
      {
        "time": "17:00",
        "title": "Contact",
        "context": null
      }
    ],
    "summary": "Light day with only 2 calls, both strategic..."
  },
  "learnings": [
    {
      "text": "**Telegram integrations:** There are TWO separate...",
      "timestamp": "2026-01-19",
      "source": "Core Memory"
    }
  ]
}
```

### 2. GET /api/context/memory
Returns just memory/about me context.

**Response:**
```json
{
  "name": "DK",
  "timezone": "Madrid",
  "location": "Barcelona",
  "goals": ["..."],
  "preferences": {"Tone": "Direct, concise, no fluff"}
}
```

### 3. GET /api/context/today
Returns just today's context (brief + todos).

**Response:**
```json
{
  "morning_brief_time": "Tuesday, 2026-01-27",
  "todos": {
    "total": 30,
    "completed": 22,
    "pending": 8
  },
  "next_calls": [
    {
      "time": "16:00",
      "title": "Contact Name",
      "context": null
    }
  ],
  "summary": "Light day with only 2 calls..."
}
```

### 4. GET /api/context/learnings
Returns just learnings.

**Response:**
```json
[
  {
    "text": "**Telegram integrations:** There are TWO separate...",
    "timestamp": "2026-01-19",
    "source": "Core Memory"
  }
]
```

## Caching

- Cache TTL: 5 minutes (300 seconds)
- Cache applies to the full context endpoint
- Individual endpoints do not cache (they parse on demand)

## File Sources

- **Memory:** `/Vault/Core Memory/About me.md` + `/Vault/Core Memory/Goals.md`
- **Daily Brief:** `/Vault/0 - Daily Briefs/{today}.md` (falls back to yesterday)
- **Todos:** `/Vault/3 - Todos/{today}.md` (falls back to yesterday)
- **Learnings:** `/Vault/Core Memory/Learnings.md`

## Error Handling

All parsers return sensible defaults if files don't exist or parsing fails:
- Memory: Returns "User", "UTC", "Unknown" with empty goals/preferences
- Todos: Returns zeros (0/0/0)
- Brief: Returns null/empty values
- Learnings: Returns empty array

No exceptions are raised - the API always returns valid JSON.
