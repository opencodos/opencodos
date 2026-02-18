# Cloudbot GitHub Monitor - Setup Guide

**For: Team**
**Purpose:** Securely monitor and parse new GitHub commits from the Cloudbot repository

---

## Overview

This system monitors a specified GitHub repository (Cloudbot) for new commits and:
- Fetches commit details securely via GitHub MCP
- Validates and sanitizes all inputs to prevent injection attacks
- Rate limits API calls to stay within GitHub limits
- Generates markdown reports in the Obsidian Vault
- Maintains audit logs for security tracking
- Can optionally auto-apply changes (disabled by default for safety)

---

## Security Features Implemented

1. **Rate Limiting:** Max 30 API calls per hour to prevent abuse
2. **Repository Whitelist:** Only allows repos matching `cloudbot/*` or `claudebot/*` patterns
3. **Input Sanitization:** All commit messages, file names, and data are sanitized
4. **Audit Logging:** All operations logged to `/dev/Ops/github/cloudbot-audit.log`
5. **Webhook Signature Verification:** HMAC-SHA256 signature validation (if using webhooks)
6. **No Auto-Apply by Default:** Prevents automatic code execution without review

---

## Setup Instructions

### Step 1: Create Required Directories

```bash
cd /path/to/codos

# Create operations directories
mkdir -p dev/Ops/github
mkdir -p dev/Ops/secrets

# Create output directory
mkdir -p "$VAULT_PATH/1 - Inbox (Last 7 days)/Github/Cloudbot"
```

### Step 2: Configure the Repository

```bash
cd /path/to/codos/ingestion/Github

# Copy example config
cp cloudbot-config.example.json ../../dev/Ops/github/cloudbot-config.json

# Edit configuration
nano ../../dev/Ops/github/cloudbot-config.json
```

**Update these fields:**

```json
{
  "repo": "owner/cloudbot",  // ← CHANGE THIS to actual repo (e.g., "anthropics/cloudbot")
  "branch": "main",          // ← Change if monitoring different branch
  "enabled": true,           // ← IMPORTANT: Set to true to enable monitoring
  "checkInterval": 30,       // Check every 30 minutes
  "autoApply": false,        // ← Keep false for safety (manual review required)
  "notifyTelegram": true     // ← Set to false if you don't want Telegram notifications
}
```

### Step 3: Set Up Webhook Secret (Optional)

If you plan to use GitHub webhooks instead of polling:

```bash
# Generate a secure webhook secret
openssl rand -hex 32 > /path/to/codos/dev/Ops/secrets/github-webhook-secret.txt

# Secure the file
chmod 600 /path/to/codos/dev/Ops/secrets/github-webhook-secret.txt
```

**Then configure GitHub webhook:**
1. Go to repository Settings → Webhooks → Add webhook
2. Payload URL: Your server endpoint (if you set one up)
3. Content type: `application/json`
4. Secret: Use the value from `github-webhook-secret.txt`
5. Events: Select "Just the push event"

### Step 4: Test the Monitor

```bash
cd /path/to/codos/ingestion/Github

# Run manual test
bun run cloudbot-monitor.ts
```

**Expected output:**
```
============================================================
Cloudbot Monitor - Secure GitHub Commit Parser
============================================================
✅ Monitoring: owner/cloudbot
   Branch: main
   Auto-apply: DISABLED
   Last processed: none

📡 Fetching commits...
   Found 10 total commits
   5 new commits to process

📝 Report saved: $VAULT_PATH/1 - Inbox (Last 7 days)/Github/Cloudbot/2026-01-26-18-30-00.md

✅ Cloudbot monitor complete
```

### Step 5: Set Up Automated Monitoring (Cron)

Add to your crontab to run every 30 minutes:

```bash
# Edit crontab
crontab -e

# Add this line (adjust path if needed):
*/30 * * * * cd /path/to/codos/ingestion/Github && bun run cloudbot-monitor.ts >> /path/to/codos/dev/Ops/github/cloudbot-cron.log 2>&1
```

Or integrate into the existing morning sync script at `/path/to/codos/ingestion/Telegram-agent/cron_sync.sh`:

```bash
# Add after line 54 (after GitHub sync)
echo "[$(date)] Running Cloudbot monitor..." >> logs/summary.log
cd "../Github"
bun run cloudbot-monitor.ts >> ../Telegram-agent/logs/summary.log 2>&1
cd "../Telegram-agent"
```

---

## Configuration Files Reference

| File | Location | Purpose |
|------|----------|---------|
| Main script | `ingestion/Github/cloudbot-monitor.ts` | The monitoring script |
| Config | `dev/Ops/github/cloudbot-config.json` | Repository and behavior settings |
| State | `dev/Ops/github/cloudbot-state.json` | Tracks processed commits (auto-created) |
| Rate limit | `dev/Ops/github/cloudbot-rate-limit.json` | API rate limiting state (auto-created) |
| Audit log | `dev/Ops/github/cloudbot-audit.log` | Security audit trail (auto-created) |
| Webhook secret | `dev/Ops/secrets/github-webhook-secret.txt` | HMAC secret for webhooks (optional) |
| Output | `Vault/1 - Inbox (Last 7 days)/Github/Cloudbot/` | Generated markdown reports |

---

## Security Best Practices

### ✅ DO:
- Keep `autoApply` set to `false` until you've thoroughly tested
- Review the audit log regularly: `tail -f dev/Ops/github/cloudbot-audit.log`
- Verify repository name is correct before enabling
- Check rate limit status if seeing errors
- Review generated reports before applying changes manually

### ❌ DON'T:
- Don't set `autoApply: true` without understanding the risks
- Don't modify the repository whitelist without security review
- Don't share webhook secrets
- Don't disable rate limiting
- Don't bypass input sanitization

---

## Troubleshooting

### Issue: "Rate limit exceeded"

**Solution:**
```bash
# Check current rate limit state
cat /path/to/codos/dev/Ops/github/cloudbot-rate-limit.json

# Reset rate limit (use carefully)
rm /path/to/codos/dev/Ops/github/cloudbot-rate-limit.json
```

### Issue: "Repository not authorized"

**Cause:** Repository name doesn't match whitelist patterns.

**Solution:** Update the whitelist in `cloudbot-monitor.ts` line 34-37:
```typescript
ALLOWED_REPOS: [
  /^claudebot\//i,
  /^cloudbot\//i,
  /^yourorg\//i,  // Add your organization
],
```

### Issue: No new commits detected

**Solution:**
```bash
# Check state file
cat /path/to/codos/dev/Ops/github/cloudbot-state.json

# Reset state to re-process commits (careful - will reprocess all)
rm /path/to/codos/dev/Ops/github/cloudbot-state.json
```

### Issue: MCP connection failed

**Solution:**
```bash
# Test MCP directly
/path/to/codos/dev/Ops/mcp/run-mcp.sh github 'Use GITHUB_GET_AUTHENTICATED_USER to get current user info'

# Check if GitHub token is valid
# Update token in MCP configuration if needed
```

---

## Monitoring & Maintenance

### Check Audit Logs

```bash
# View recent audit events
tail -50 /path/to/codos/dev/Ops/github/cloudbot-audit.log | jq .

# Filter by severity
grep '"severity":"ERROR"' /path/to/codos/dev/Ops/github/cloudbot-audit.log | jq .
grep '"severity":"CRITICAL"' /path/to/codos/dev/Ops/github/cloudbot-audit.log | jq .
```

### View Generated Reports

```bash
# List all reports
ls -lt "$VAULT_PATH/1 - Inbox (Last 7 days)/Github/Cloudbot/"

# View latest report
cat "$VAULT_PATH/1 - Inbox (Last 7 days)/Github/Cloudbot/"$(ls -t "$VAULT_PATH/1 - Inbox (Last 7 days)/Github/Cloudbot/" | head -1)
```

### Clean Up Old Data

State file can grow unbounded. Clean periodically:

```bash
# Backup current state
cp /path/to/codos/dev/Ops/github/cloudbot-state.json \
   /path/to/codos/dev/Ops/github/cloudbot-state.backup.json

# Edit state file to keep only recent 100 commits
# This is done automatically (keeps last 1000), but you can reduce if needed
```

---

## Next Steps After Setup

1. **Test manually** with `bun run cloudbot-monitor.ts`
2. **Review first report** in Obsidian Vault to ensure data looks correct
3. **Enable cron job** once confident in the setup
4. **Monitor audit logs** for first few days to catch any issues
5. **Integrate with Telegram notifications** if desired (see `/ingestion/atlas-bot/`)

---

## Advanced: Auto-Apply Implementation

⚠️ **WARNING:** Auto-apply will automatically attempt to implement changes from commits. Only enable this if:
- You fully trust the source repository
- You have proper backup/rollback mechanisms
- You've tested extensively in a non-production environment

To implement auto-apply (future enhancement):

1. Create `/path/to/codos/ingestion/Github/cloudbot-apply.ts`
2. Implement change application logic with:
   - File diff analysis
   - Conflict detection
   - Automated testing
   - Rollback capability
3. Update `cloudbot-monitor.ts` to call apply script when `autoApply: true`

**This is intentionally not implemented yet for safety.**

---

## Support

For issues or questions:
- Check audit logs: `tail -f dev/Ops/github/cloudbot-audit.log`
- Review this documentation
- Test with small changes first
- Ask for security review before enabling auto-apply

---

**Setup completed: [Date]**
**Configured by: Team**
**Monitoring: [Repository name]**
