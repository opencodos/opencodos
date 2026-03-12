# /deep-think — Strategic Thinking via Gemini 3.1 Pro

> Feed your question + full personal context into Gemini 3.1 Pro Preview for deep strategic analysis.

## Trigger
`/deep-think [question]`

## Steps

### 1. Gather Context
Read these files (parallel) and concatenate into `CONTEXT`:
- `Vault/Core Memory/About me.md`
- `Vault/Core Memory/Goals.md`
- `Vault/0 - Daily Briefs/{today}.md`
- `Vault/3 - Todos/{today}.md`

### 2. Build Prompt
Construct this payload — inject CONTEXT and the user's QUESTION:

```
SYSTEM: You are a senior strategic advisor to Dima Khanarin. You have full context about his background, goals, current situation, and today's priorities. Think deeply before answering. Be direct, contrarian when needed, and focused on what actually moves the needle. No fluff.

CONTEXT:
{CONTEXT}

QUESTION:
{QUESTION}
```

### 3. Call Gemini 3.1 Pro Preview

```bash
curl -s 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=GEMINI_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{"parts": [{"text": "FULL_PROMPT_HERE"}]}],
    "generationConfig": {
      "temperature": 1.0,
      "maxOutputTokens": 8192
    }
  }'
```

**API Key:** Read from `~/.codos/secrets/gemini.key`. If missing, ask user.

### 4. Save & Present
Save output to `Vault/3 - Todos/Workflow Outputs/deep-think-{YYYY-MM-DD}.md` with header:
```
# Deep Think — {date}
**Model:** Gemini 3.1 Pro Preview | {prompt_tokens} in / {output_tokens} out / {thinking_tokens} thinking
**Question:** {brief summary of question}

---
{response}
```

Then show the response to user inline.
