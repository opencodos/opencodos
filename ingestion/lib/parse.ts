/**
 * Shared JSON parsing utility for ingestion scripts.
 *
 * Tries 3 strategies to extract JSON from LLM / MCP responses:
 * 1. Code-block regex (```json ... ```)
 * 2. Bracket-counting array extraction with fallback
 * 3. Raw object regex
 *
 * Returns parsed value or null when no JSON is found.
 */

export function parseJSON(response: string): any {
  // Try code blocks first (greedy match to get full content)
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Fall through
    }
  }

  // Try to extract JSON array by finding balanced brackets
  const arrayStart = response.indexOf("[");
  if (arrayStart !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    let lastValidEnd = -1;

    for (let i = arrayStart; i < response.length; i++) {
      const char = response[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "[") depth++;
      if (char === "]") {
        depth--;
        if (depth === 0) {
          lastValidEnd = i;
          try {
            return JSON.parse(response.slice(arrayStart, i + 1));
          } catch (e) {
            // Continue looking for a valid end
          }
        }
      }
    }

    // If we found at least one closing bracket, try that
    if (lastValidEnd !== -1) {
      try {
        return JSON.parse(response.slice(arrayStart, lastValidEnd + 1));
      } catch (e) {
        // Fall through
      }
    }
  }

  // Try raw JSON object
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (e) {
      // Fall through
    }
  }

  return null;
}
