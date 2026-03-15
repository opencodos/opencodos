/**
 * Shared utilities for conversation configuration modals (Telegram, Slack, etc.)
 */

export type TimePeriod = '7d' | '30d' | '90d' | 'custom';

export const TIME_PERIODS: Array<{ label: string; value: Exclude<TimePeriod, 'custom'> }> = [
  { label: 'Last 7 days', value: '7d' },
  { label: 'Last 30 days', value: '30d' },
  { label: 'Last 90 days', value: '90d' },
];

export const PERIOD_TO_DAYS: Record<Exclude<TimePeriod, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/**
 * Derives the initial time selection state from a lookback days value
 */
export function deriveInitialTimeSelection(lookbackDays?: number): {
  period: TimePeriod;
  customDate?: Date;
  expanded: boolean;
} {
  // Default to 7 days if not provided
  if (!lookbackDays) {
    return { period: '7d', expanded: false };
  }

  // Try to match to predefined periods
  for (const [period, days] of Object.entries(PERIOD_TO_DAYS) as Array<
    [Exclude<TimePeriod, 'custom'>, number]
  >) {
    if (lookbackDays === days) {
      return { period, expanded: false };
    }
  }

  // Custom period - calculate the date
  const customDate = new Date();
  customDate.setDate(customDate.getDate() - lookbackDays);
  customDate.setHours(0, 0, 0, 0);

  return {
    period: 'custom',
    customDate,
    expanded: true,
  };
}

/**
 * Computes the number of lookback days from a time period and optional custom date
 */
export function computeLookbackDays(period: TimePeriod, customDate?: Date): number {
  if (period === 'custom') {
    if (!customDate) {
      return 7; // Default to 7 days
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(customDate);
    start.setHours(0, 0, 0, 0);
    const diffTime = now.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(diffDays, 1); // At least 1 day
  }

  return PERIOD_TO_DAYS[period];
}

/**
 * Filters conversations by search query
 */
export function filterConversationsBySearch<T extends { name: string }>(
  conversations: T[],
  searchQuery: string,
): T[] {
  if (!searchQuery) return conversations;
  const query = searchQuery.toLowerCase();
  return conversations.filter((conversation) => conversation.name.toLowerCase().includes(query));
}
