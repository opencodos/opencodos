# Ops

MCP configurations and operational tooling.

## Files

| File | Purpose |
|------|---------|
| `env.sh` | Shell environment loader (sources secrets via `python -m backend secrets export`) |
| `mcp/` | Minimal MCP configs, tests, and runbooks |

## Secrets

API keys and credentials are stored in the pluggable secrets backend (default: `~/.codos/secrets.json`).

```bash
# Read a secret
python -m backend secrets get ANTHROPIC_API_KEY

# Export all secrets as shell variables
eval "$(python -m backend secrets export --shell)"
```

See `backend/codos_utils/secrets/` for the backend implementation.

## Security

- Never commit secrets files
- Rotate keys quarterly
- `~/.codos/secrets.json` is created with `0600` permissions
