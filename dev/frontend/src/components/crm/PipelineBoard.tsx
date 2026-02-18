import { useState, useMemo, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragStartEvent, DragOverEvent, DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { Contact, DealStage } from './types';
import { DEAL_STAGES } from './types';
import { Badge } from '@/components/ui/badge';
import { DollarSign } from 'lucide-react';
import { ContactCard, ContactCardOverlay } from './ContactCard';

interface PipelineBoardProps {
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
  onContactUpdate?: (contactId: string, updates: Partial<Contact>) => Promise<void>;
}

function formatDealValue(value: number | null): string {
  if (!value) return '';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

function getStageColor(stage: DealStage): string {
  switch (stage) {
    case 'to_connect':
      return 'border-cyan-500/50';
    case 'first_contact':
      return 'border-blue-500/50';
    case 'call':
      return 'border-purple-500/50';
    case 'negotiation':
      return 'border-yellow-500/50';
    case 'closed_won':
      return 'border-green-500/50';
    case 'closed_lost':
      return 'border-red-500/50';
    default:
      return 'border-white/20';
  }
}

function getStageHeaderColor(stage: DealStage): string {
  switch (stage) {
    case 'to_connect':
      return 'bg-cyan-500/10 text-cyan-400';
    case 'first_contact':
      return 'bg-blue-500/10 text-blue-400';
    case 'call':
      return 'bg-purple-500/10 text-purple-400';
    case 'negotiation':
      return 'bg-yellow-500/10 text-yellow-400';
    case 'closed_won':
      return 'bg-green-500/10 text-green-400';
    case 'closed_lost':
      return 'bg-red-500/10 text-red-400';
    default:
      return 'bg-white/5 text-gray-400';
  }
}

// Droppable column component
interface StageColumnProps {
  stage: {
    value: string;
    label: string;
    contacts: Contact[];
    total: number;
    count: number;
  };
  onContactClick: (contact: Contact) => void;
}

function StageColumn({ stage, onContactClick }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage.value}`,
    data: {
      type: 'column',
      stage: stage.value,
    },
  });

  return (
    <div
      className={`flex-shrink-0 w-[280px] rounded-lg border ${getStageColor(stage.value as DealStage)} bg-white/[0.02] transition-colors ${
        isOver ? 'bg-blue-500/10 border-blue-500/50' : ''
      }`}
    >
      {/* Stage Header */}
      <div
        className={`px-4 py-3 rounded-t-lg ${getStageHeaderColor(stage.value as DealStage)}`}
      >
        <div className="flex items-center justify-between">
          <span className="font-medium">{stage.label}</span>
          <Badge variant="secondary" className="bg-white/10 text-white">
            {stage.count}
          </Badge>
        </div>
        {stage.total > 0 && (
          <p className="text-sm opacity-80 mt-1">{formatDealValue(stage.total)}</p>
        )}
      </div>

      {/* Stage Contacts - SortableContext for items in this column */}
      <div ref={setNodeRef} className="p-2 space-y-2 max-h-[500px] overflow-y-auto min-h-[100px]">
        <SortableContext
          items={stage.contacts.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {stage.contacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              onClick={() => onContactClick(contact)}
            />
          ))}
        </SortableContext>

        {/* Empty state */}
        {stage.contacts.length === 0 && (
          <div className={`text-center py-8 transition-colors ${isOver ? 'text-blue-400' : ''}`}>
            <p className="text-xs text-gray-600">
              {isOver ? 'Drop here' : 'No deals'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelineBoard({ contacts, onContactClick, onContactUpdate }: PipelineBoardProps) {
  // Local state for optimistic updates
  const [localContacts, setLocalContacts] = useState<Contact[]>(contacts);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Sync local state when props change (but not during drag)
  useMemo(() => {
    if (!activeId) {
      setLocalContacts(contacts);
    }
  }, [contacts, activeId]);

  // Configure sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement before drag starts (allows clicks)
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Find contact by ID
  const findContact = useCallback(
    (id: string) => localContacts.find((c) => c.id === id),
    [localContacts]
  );

  // Get active contact for drag overlay
  const activeContact = activeId ? findContact(activeId) : null;

  // Group contacts by stage
  const stages = useMemo(() => {
    const stageMap: Record<string, Contact[]> = {};

    // Initialize all stages
    DEAL_STAGES.forEach((stage) => {
      stageMap[stage.value] = [];
    });

    // Add a "No Stage" bucket for contacts without a deal_stage
    stageMap['no_stage'] = [];

    // Distribute contacts
    localContacts.forEach((contact) => {
      if (contact.deal_stage && stageMap[contact.deal_stage]) {
        stageMap[contact.deal_stage].push(contact);
      } else {
        stageMap['no_stage'].push(contact);
      }
    });

    // Calculate totals for each stage
    return DEAL_STAGES.map((stage) => ({
      ...stage,
      contacts: stageMap[stage.value].sort((a, b) => (b.deal_value || 0) - (a.deal_value || 0)),
      total: stageMap[stage.value].reduce((sum, c) => sum + (c.deal_value || 0), 0),
      count: stageMap[stage.value].length,
    })).filter((stage) => !['closed_won', 'closed_lost'].includes(stage.value) || stage.count > 0);
  }, [localContacts]);

  const pipelineTotal = stages
    .filter((s) => !['closed_won', 'closed_lost'].includes(s.value))
    .reduce((sum, s) => sum + s.total, 0);

  // Drag event handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeContactId = active.id as string;
    const overId = over.id as string;

    // Determine target stage
    let targetStage: string | null = null;

    if (overId.startsWith('column-')) {
      // Dropped directly on a column
      targetStage = overId.replace('column-', '');
    } else {
      // Dropped on another contact - find which column it's in
      const overContact = findContact(overId);
      if (overContact) {
        targetStage = overContact.deal_stage;
      }
    }

    if (!targetStage) return;

    // Find current contact
    const activeContact = findContact(activeContactId);
    if (!activeContact || activeContact.deal_stage === targetStage) return;

    // Optimistic update - move contact to new stage
    setLocalContacts((prev) =>
      prev.map((c) =>
        c.id === activeContactId ? { ...c, deal_stage: targetStage } : c
      )
    );
  }, [findContact]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);

      if (!over) {
        // Drag cancelled - reset to original
        setLocalContacts(contacts);
        return;
      }

      const activeContactId = active.id as string;
      const overId = over.id as string;

      // Determine final target stage
      let targetStage: string | null = null;

      if (overId.startsWith('column-')) {
        targetStage = overId.replace('column-', '');
      } else {
        const overContact = findContact(overId);
        if (overContact) {
          targetStage = overContact.deal_stage;
        }
      }

      const activeContact = contacts.find((c) => c.id === activeContactId);
      if (!targetStage || !activeContact || activeContact.deal_stage === targetStage) {
        return;
      }

      // Persist to API if handler provided
      if (onContactUpdate) {
        try {
          await onContactUpdate(activeContactId, { deal_stage: targetStage });
        } catch (error) {
          console.error('Failed to update contact stage:', error);
          // Revert on error
          setLocalContacts(contacts);
        }
      }
    },
    [contacts, findContact, onContactUpdate]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setLocalContacts(contacts);
  }, [contacts]);

  return (
    <div className="space-y-4">
      {/* Pipeline Summary */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{localContacts.length} deals in pipeline</p>
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-green-400" />
          <span className="text-lg font-semibold text-green-400">
            {formatDealValue(pipelineTotal)}
          </span>
          <span className="text-sm text-gray-500">pipeline value</span>
        </div>
      </div>

      {/* Kanban Board with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <StageColumn
              key={stage.value}
              stage={stage}
              onContactClick={onContactClick}
            />
          ))}
        </div>

        {/* Drag Overlay - shows preview while dragging */}
        <DragOverlay>
          {activeContact ? <ContactCardOverlay contact={activeContact} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
