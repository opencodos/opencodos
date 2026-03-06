// Utility functions for workflow management

/**
 * Format a date string to a human-readable relative time
 * @param dateString - ISO date string
 * @returns Human-readable relative time (e.g., "2 hours ago", "Never")
 */
export function formatLastExecuted(dateString?: string): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * Parse workflow execution status from last_results JSON string
 * @param lastResults - JSON string containing execution results
 * @returns Status object with success flag and message
 */
export function parseWorkflowStatus(lastResults?: string): {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
} {
  if (!lastResults) {
    return {
      success: false,
      message: 'No execution history',
    };
  }

  try {
    const results = JSON.parse(lastResults);

    // Check for status field
    if (results.status === 'success') {
      return {
        success: true,
        message: results.message || 'Success',
        details: results,
      };
    } else if (results.status === 'error' || results.status === 'failed') {
      return {
        success: false,
        message: results.message || 'Execution failed',
        details: results,
      };
    }

    // Fallback: check for error field
    if (results.error || results.errors) {
      return {
        success: false,
        message: results.error || 'Execution failed with errors',
        details: results,
      };
    }

    // If no explicit status, assume success if there's data
    return {
      success: true,
      message: results.message || 'Completed',
      details: results,
    };
  } catch (error) {
    console.warn('Got invalid execution results:', error);
    return {
      success: false,
      message: 'Invalid execution results',
    };
  }
}

/**
 * Generate a detailed tooltip message from workflow execution results
 * @param lastResults - JSON string containing execution results
 * @returns Detailed tooltip message with execution stats
 */
export function getStatusTooltip(lastResults?: string): string {
  const status = parseWorkflowStatus(lastResults);

  if (!lastResults || !status.details) {
    return status.message;
  }

  const details = status.details;
  const parts: string[] = [status.message];

  // Add relevant stats if they exist
  if (details.messages_synced !== undefined) {
    parts.push(`${details.messages_synced} messages synced`);
  }
  if (details.conversations_processed !== undefined) {
    parts.push(`${details.conversations_processed} conversations processed`);
  }
  if (details.documents_created !== undefined) {
    parts.push(`${details.documents_created} documents created`);
  }
  if (details.errors && Array.isArray(details.errors) && details.errors.length > 0) {
    parts.push(`${details.errors.length} error(s)`);
  }

  return parts.join(' • ');
}

/**
 * Format schedule seconds to human-readable string
 * @param seconds - Schedule interval in seconds
 * @returns Human-readable schedule string
 */
export function formatSchedule(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `Every ${days} day${days === 1 ? '' : 's'}`;
  if (hours > 0) return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
  if (minutes > 0) return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `Every ${seconds} second${seconds === 1 ? '' : 's'}`;
}

/**
 * Get status variant for badge component
 * @param success - Whether the last execution was successful
 * @returns Badge variant string
 */
export function getStatusVariant(success: boolean): 'default' | 'destructive' | 'secondary' {
  return success ? 'default' : 'destructive';
}
