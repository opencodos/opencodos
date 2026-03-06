#!/usr/bin/env bun
/**
 * Hook that streams Claude Code events to the backend API.
 * Called by PreToolUse, PostToolUse, Notification, Stop hooks.
 *
 * Input: JSON payload from stdin containing hook event data
 * Output: { "continue": true } to stdout to allow Claude to proceed
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

    // Build event object - only fields matching HookEvent model
    const event = {
      sessionId,
      hookEvent: payload.hook_event_name || 'unknown',
      timestamp: new Date().toISOString(),

      // Tool info (PreToolUse, PostToolUse)
      toolName: payload.tool_name || null,
      toolInput: payload.tool_input || null,
      toolResponse: payload.tool_response || null,

      // Notification info
      message: payload.message || null,
      notificationType: payload.notification_type || null,

      // Stop hook info
      transcriptPath: payload.transcript_path || null,
      stopReason: payload.reason || null,
    };

    // POST to backend with 5s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('http://localhost:8767/api/hook-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(atlasApiKey ? { 'X-Atlas-Key': atlasApiKey } : {}),
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Failed to send event: ${response.status}`);
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (!(fetchError instanceof DOMException && fetchError.name === 'AbortError')) {
        console.error('Fetch error:', fetchError);
      }
    }

    // Return success to Claude Code - always continue
    console.log(JSON.stringify({ continue: true }));
  } catch (error) {
    console.error('Hook error:', error);
    // Always return continue: true to not block Claude
    console.log(JSON.stringify({ continue: true }));
  }

  process.exit(0);
});
