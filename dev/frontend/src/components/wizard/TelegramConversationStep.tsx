import { useCallback, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { integrationAPI } from '@/lib/api';
import {
  TelegramConversationPicker,
  type TelegramConversationPickerHandle,
} from '@/components/connectors/TelegramConversationPicker';

interface TelegramConversationStepProps {
  connectors: string[];
  onComplete: () => void;
  onSkip: () => void;
}

export function TelegramConversationStep({
  connectors,
  onComplete,
  onSkip,
}: TelegramConversationStepProps) {
  const telegramEnabled = connectors.includes('telegram');
  const pickerRef = useRef<TelegramConversationPickerHandle>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState({ loading: true, syncRunning: false, selectedCount: 0 });

  const handleCancelSync = useCallback(async () => {
    const result = await integrationAPI.cancelTelegramSync();
    if (!result.success) {
      throw new Error(result.message);
    }
    // Small delay for lock to release, then refetch
    await new Promise((r) => setTimeout(r, 500));
    pickerRef.current?.refetch();
  }, []);

  const handleSave = async () => {
    const state = pickerRef.current?.getState();
    if (!state) return;

    try {
      setSaving(true);
      setSaveError(null);

      const selectedSet = new Set(state.selectedIds);
      const conversationDetails = state.conversations
        .filter((c) => selectedSet.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, type: c.type }));

      const [configResult, filtersResult] = await Promise.all([
        integrationAPI.saveTelegramConfig({
          include_conversations: state.selectedIds,
          lookback_days: state.lookbackDays,
          conversation_details: conversationDetails,
        }),
        integrationAPI.saveTelegramFilters(state.filters),
      ]);

      if (!configResult.success) {
        setSaveError(configResult.message || 'Failed to save configuration');
        return;
      }

      if (!filtersResult.success) {
        setSaveError('Failed to save sync settings');
        return;
      }

      onComplete();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // Not enabled state
  if (!telegramEnabled) {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-light mb-2 text-white">Select Telegram Chats</h1>
          <p className="text-gray-400">Telegram connector not selected</p>
        </div>

        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-gray-500/20 flex items-center justify-center border border-gray-500/30 mb-4">
            <svg
              className="w-8 h-8 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-gray-400 text-center">
            You didn&apos;t select Telegram as a connector.
            <br />
            You can skip this step.
          </p>
        </div>

        <button
          onClick={onSkip}
          className="w-full py-3 bg-white/10 text-white rounded-lg font-medium hover:bg-white/20 transition"
        >
          Skip
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-light mb-2 text-white">Select Telegram Chats</h1>
        <p className="text-gray-400">
          Select chats to always sync, plus optionally auto-discover unread ones
        </p>
      </div>

      <TelegramConversationPicker
        ref={pickerRef}
        onCancelSync={handleCancelSync}
        onStatusChange={setStatus}
      />

      {!status.syncRunning && (
        <>
          {/* Save error */}
          {saveError && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-sm text-center">{saveError}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onSkip}
              disabled={saving}
              className="flex-1 py-3 bg-transparent border border-atlas-border text-gray-400 rounded-lg font-medium hover:border-gray-500 hover:text-gray-300 transition disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={handleSave}
              disabled={saving || status.loading}
              className="flex-1 py-3 bg-white text-black rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save & Continue'}
            </button>
          </div>

          <p className="text-center text-xs text-gray-600">
            {status.selectedCount} conversation{status.selectedCount !== 1 ? 's' : ''} selected
          </p>
        </>
      )}
    </div>
  );
}
