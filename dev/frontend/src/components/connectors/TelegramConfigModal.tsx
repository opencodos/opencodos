import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { integrationAPI, workflowAPI } from '@/lib/api';
import type { ConversationWorkflowConfig, Workflow } from '@/types';
import telegramIcon from '@/assets/telegramIcon.svg';
import {
  TelegramConversationPicker,
  type TelegramConversationPickerHandle,
} from '@/components/connectors/TelegramConversationPicker';

interface TelegramConfigModalProps {
  workflow: Workflow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function TelegramConfigModal({ workflow, onClose, onSaved }: TelegramConfigModalProps) {
  const pickerRef = useRef<TelegramConversationPickerHandle>(null);

  const workflowConfig = useMemo(
    () => (workflow?.config || {}) as Partial<ConversationWorkflowConfig>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workflow?.config ? JSON.stringify(workflow.config) : ''],
  );

  const fallbackWhitelistIds = useMemo(
    () => workflowConfig.conversation_filters?.include ?? [],
    [workflowConfig.conversation_filters?.include],
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState({ loading: true, syncRunning: false, selectedCount: 0 });

  // Track backend whitelist length for confirmation guard
  const [backendCount, setBackendCount] = useState(0);

  const handleSave = async () => {
    const state = pickerRef.current?.getState();
    if (!state) return;

    // Guard: warn if saving significantly fewer conversations than currently synced
    if (backendCount > 0) {
      if (state.selectedIds.length === 0) {
        const confirmed = window.confirm(
          `You have ${backendCount} conversations currently synced. Save with 0 selected? This will stop all syncing.`,
        );
        if (!confirmed) return;
      } else if (state.selectedIds.length < backendCount * 0.5) {
        const confirmed = window.confirm(
          `You're about to save ${state.selectedIds.length} conversations, down from ${backendCount} currently synced. Continue?`,
        );
        if (!confirmed) return;
      }
    }

    try {
      setSaving(true);
      setSaveError(null);

      const updatedConfig: ConversationWorkflowConfig = {
        target_group_id: '',
        target_parent_document_id: '',
        initial_lookback_days: state.lookbackDays,
        conversation_filters: {
          include: state.selectedIds,
          exclude: [],
        },
      };

      if (!workflow?.id) {
        throw new Error('No Telegram workflow found. Please refresh and try again.');
      }

      // Save to local workflow storage
      await workflowAPI.updateWorkflow(workflow.id, { config: updatedConfig });

      // Build conversation details from selected IDs
      const selectedSet = new Set(state.selectedIds);
      const conversationDetails = state.conversations
        .filter((c) => selectedSet.has(c.id))
        .map((c) => ({ id: c.id, name: c.name, type: c.type }));

      // Persist to backend
      const backendResult = await integrationAPI.saveTelegramConfig({
        include_conversations: state.selectedIds,
        lookback_days: state.lookbackDays,
        conversation_details: conversationDetails,
      });

      if (!backendResult.success) {
        console.warn('Failed to save config to backend:', backendResult.message);
      }

      // Save sync filters
      const filtersResult = await integrationAPI.saveTelegramFilters(state.filters);
      if (!filtersResult.success) {
        console.warn('Failed to save filters to backend');
      }

      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to update workflow');
    } finally {
      setSaving(false);
    }
  };

  const canSave = workflow !== null;

  return (
    <Card className="w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden bg-background border-border">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center">
              <img src={telegramIcon} alt="Telegram" className="h-8 w-8" />
            </div>
            <span className="text-xl font-semibold">Telegram</span>
          </div>
        </div>

        <div>
          <h2 className="text-xl font-semibold text-balance">Select conversations to sync</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which private chats, groups, and channels to import
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 overflow-y-auto flex-1">
        {!workflow ? (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            Telegram is connected, but the workflow record is still provisioning. Please close this
            dialog and try again once the connection finishes syncing.
          </div>
        ) : null}

        <TelegramConversationPicker
          ref={pickerRef}
          fallbackWhitelistIds={fallbackWhitelistIds}
          fallbackLookbackDays={workflowConfig.initial_lookback_days}
          onStatusChange={(s) => {
            setStatus(s);
            // Track backend count from first non-loading status for confirmation guard
            if (!s.loading && backendCount === 0 && s.selectedCount > 0) {
              setBackendCount(s.selectedCount);
            }
          }}
        />

        <div className="flex items-center gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
            Cancel
          </Button>

          <Button
            className="flex-1 bg-[#0088cc] hover:bg-[#0088cc]/90 text-white"
            onClick={handleSave}
            disabled={saving || !canSave || status.loading}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Update Workflow
          </Button>
        </div>

        {saveError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{saveError}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
