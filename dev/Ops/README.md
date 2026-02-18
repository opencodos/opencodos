# Ops

Environment secrets and configuration.

## Files

| File | Purpose |
|------|---------|
| `.env` | API keys and secrets (hidden, gitignored) |
| `mcp/` | Minimal MCP configs, tests, and runbooks |

## Usage

Scripts load secrets from `.env` automatically:
- `run-brief.sh` — sources before running morning brief
- `config.py` — loads via python-dotenv

## Security

- Never commit `.env`
- Rotate keys quarterly
- See `Vault/2 - Projects/DKOS/Security Remediation.md` for details
