#!/usr/bin/env bun
/**
 * Hook that handles permission requests by forwarding to UI and waiting for response.
 * This hook BLOCKS Claude execution until the user responds in the UI.
 *
 * Input: JSON payload from stdin containing permission request data
 * Output: Permission decision to stdout in hookSpecificOutput format
 *
 * Flow:
 * 1. Claude wants to use a tool that requires permission
 * 2. This hook fires and BLOCKS execution
 * 3. We POST to backend, which sends to UI via WebSocket
 * 4. UI shows permission dialog to user
 * 5. User approves/denies
 * 6. Backend responds to our HTTP request
 * 7. We return allow/deny to Claude via hookSpecificOutput
 */

// Read hook payload from stdin
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', async () => {
  try {
    const atlasApiKey = process.env.ATLAS_API_KEY?.trim();
    const payload = JSON.parse(input);

    // Extract session ID from cwd (e.g., ~/.codos/sessions/abc123/)
    const cwd = payload.cwd || '';
    const match = cwd.match(/sessions\/([^/]+)/);
    const sessionId = match ? match[1] : 'unknown';

    const toolUseId = payload.tool_use_id || `tool-${Date.now()}`;
    const toolName = payload.tool_name;
    const toolInput = payload.tool_input;

    // Build permission request
    const permissionRequest = {
      sessionId,
      toolUseId,
      toolName,
      toolInput,
      timestamp: new Date().toISOString(),
    };

    // POST to backend and WAIT for response (blocks Claude)
    // Backend will hold this request until UI responds or timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 55000); // 55s timeout (Claude allows 60s)

    try {
      const response = await fetch('http://localhost:8767/api/permission-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(atlasApiKey ? { 'X-Atlas-Key': atlasApiKey } : {}),
        },
        body: JSON.stringify(permissionRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();

        // Return permission decision in Claude Code hook format
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: result.approved ? 'allow' : 'deny',
              permissionDecisionReason:
                result.reason || (result.approved ? 'User approved' : 'User denied'),
            },
          })
        );
      } else {
        // Backend error - default to deny for safety
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: 'deny',
              permissionDecisionReason: `Backend error: ${response.status}`,
            },
          })
        );
      }
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        // Timeout - default to deny
        console.log(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PermissionRequest',
              permissionDecision: 'deny',
              permissionDecisionReason: 'Permission request timed out (55s)',
            },
          })
        );
      } else {
        throw fetchError;
      }
    }
  } catch (error: any) {
    console.error('Permission hook error:', error);

    // Default to deny on error for safety
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PermissionRequest',
          permissionDecision: 'deny',
          permissionDecisionReason: `Hook error: ${error.message || 'Unknown error'}`,
        },
      })
    );
  }

  process.exit(0);
});
