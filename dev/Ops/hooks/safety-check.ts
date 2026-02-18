#!/usr/bin/env bun
/**
 * PreToolUse Safety Hook
 *
 * Blocks dangerous Bash commands before execution.
 * Works even with --dangerously-skip-permissions.
 *
 * Usage: Added to ~/.claude/settings.json as PreToolUse hook
 */

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Destructive file operations
  { pattern: /rm\s+-rf\s+[\/~]/, reason: "rm -rf on root/home" },
  { pattern: /rm\s+-rf\s+\*/, reason: "rm -rf wildcard" },
  { pattern: /rm\s+-rf\s+\.\s*$/, reason: "rm -rf current directory" },

  // Git disasters
  { pattern: /git\s+push\s+.*--force/, reason: "force push" },
  { pattern: /git\s+push\s+-f/, reason: "force push" },
  { pattern: /git\s+reset\s+--hard/, reason: "hard reset" },
  { pattern: /git\s+clean\s+-fd/, reason: "clean untracked files" },

  // Database destruction
  { pattern: /DROP\s+(TABLE|DATABASE)/i, reason: "SQL DROP" },
  { pattern: /TRUNCATE\s+TABLE/i, reason: "SQL TRUNCATE" },

  // Remote code execution risks
  { pattern: /curl.*\|\s*(bash|sh|zsh)/, reason: "curl pipe to shell" },
  { pattern: /wget.*\|\s*(bash|sh|zsh)/, reason: "wget pipe to shell" },

  // System-level dangers
  { pattern: /chmod\s+777\s+\//, reason: "chmod 777 on root" },
  { pattern: /mkfs\./, reason: "format filesystem" },
  { pattern: /dd\s+if=.*of=\/dev/, reason: "dd to device" },

  // Credentials exposure
  { pattern: /cat.*\.env.*\|/, reason: "pipe .env file" },
  { pattern: /echo.*\$.*PASSWORD/, reason: "echo password variable" },

  // Secrets/sensitive files
  { pattern: /cat\s+.*\.(pem|key)/, reason: "read private key" },
  { pattern: /cat\s+~\/\.ssh/, reason: "read SSH keys" },
  { pattern: /cat\s+~\/\.aws/, reason: "read AWS credentials" },
  { pattern: /printenv.*\|/, reason: "pipe environment variables" },

  // Network exfiltration
  { pattern: /curl\s+.*-d.*\$/, reason: "curl POST with variable" },
  { pattern: /nc\s+-e/, reason: "netcat reverse shell" },
  { pattern: /nc\s+.*\|.*sh/, reason: "netcat to shell" },

  // macOS specific
  { pattern: /osascript\s+-e/, reason: "arbitrary AppleScript" },
  { pattern: /launchctl\s+load\s+(?!.*com\.dkos)/, reason: "load unknown launch agent" },

  // Accidental publishes
  { pattern: /npm\s+publish/, reason: "npm publish" },
  { pattern: /gh\s+release\s+create/, reason: "GitHub release create" },

  // History tampering
  { pattern: /history\s+-c/, reason: "clear history" },
  { pattern: /rm\s+.*\.bash_history/, reason: "delete bash history" },
  { pattern: /rm\s+.*\.zsh_history/, reason: "delete zsh history" },

  // Kubernetes/Docker destruction
  { pattern: /kubectl\s+delete\s+(namespace|ns)\s/, reason: "delete k8s namespace" },
  { pattern: /docker\s+rm.*\$\(docker\s+ps/, reason: "delete all containers" },
  { pattern: /docker\s+system\s+prune\s+-a/, reason: "docker prune all" },
];

async function main() {
  try {
    const stdin = await Bun.stdin.text();
    const event = JSON.parse(stdin);

    // Only check Bash commands
    if (event.tool !== 'Bash') {
      console.log(JSON.stringify({ decision: "approve" }));
      return;
    }

    const command = event.input?.command || '';

    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        // Log blocked command for audit
        const logEntry = {
          timestamp: new Date().toISOString(),
          command: command.slice(0, 200),
          reason,
          blocked: true,
        };
        console.error(`[SAFETY] Blocked: ${JSON.stringify(logEntry)}`);

        console.log(JSON.stringify({
          decision: "block",
          reason: `Safety hook blocked: ${reason}`,
        }));
        return;
      }
    }

    // Allow command
    console.log(JSON.stringify({ decision: "approve" }));

  } catch (error) {
    // On error, fail open (allow) but log
    console.error(`[SAFETY] Hook error: ${error}`);
    console.log(JSON.stringify({ decision: "approve" }));
  }
}

main();
