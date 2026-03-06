import { useState, useMemo } from 'react';
import {
  type TimePeriod,
  deriveInitialTimeSelection,
  computeLookbackDays,
} from '@/lib/conversationConfigUtils';

/**
 * Hook for managing time period selection state (used in conversation config modals)
 */
export function useTimePeriodSelection(initialLookbackDays?: number) {
  const timeSelection = useMemo(
    () => deriveInitialTimeSelection(initialLookbackDays),
    [initialLookbackDays],
  );

  const [selectedTimePeriod, setSelectedTimePeriod] = useState<TimePeriod>(timeSelection.period);
  const [customDate, setCustomDate] = useState<Date | undefined>(timeSelection.customDate);
  const [isCustomDateExpanded, setIsCustomDateExpanded] = useState(timeSelection.expanded);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const lookbackDays = useMemo(
    () => computeLookbackDays(selectedTimePeriod, customDate),
    [selectedTimePeriod, customDate],
  );

  return {
    selectedTimePeriod,
    setSelectedTimePeriod,
    customDate,
    setCustomDate,
    isCustomDateExpanded,
    setIsCustomDateExpanded,
    isDatePickerOpen,
    setIsDatePickerOpen,
    lookbackDays,
  };
}
