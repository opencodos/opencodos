import { type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface ConversationListSectionProps<T extends { id: string; name: string }> {
  title: string;
  conversations: T[];
  selectedIds: Set<string>;
  selectedCount: number;
  /** @deprecated No longer displayed - count shown in header instead */
  selectedLabel?: (count: number) => string;
  allSelected: boolean;
  toggleAll: () => void;
  onToggle: (id: string) => void;
  emptyMessage: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  renderIcon?: (conversation: T) => ReactNode;
  renderLabel?: (conversation: T) => ReactNode;
  chevronDirection?: 'down' | 'right';
}

export function ConversationListSection<T extends { id: string; name: string }>({
  title,
  conversations,
  selectedIds,
  selectedCount,
  allSelected,
  toggleAll,
  onToggle,
  emptyMessage,
  isOpen,
  onOpenChange,
  renderIcon,
  renderLabel,
  chevronDirection = 'right',
}: ConversationListSectionProps<T>) {
  const Chevron = chevronDirection === 'down' ? ChevronDown : ChevronRight;
  const chevronClass =
    chevronDirection === 'down'
      ? cn('h-4 w-4 transition-transform', !isOpen && '-rotate-90')
      : cn('h-4 w-4 transition-transform', isOpen && 'rotate-90');

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <div className="flex w-full items-center justify-between rounded-md bg-muted px-3 py-2 text-sm font-medium hover:bg-muted/80 cursor-pointer text-white">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => {
                toggleAll();
              }}
              onClick={(e) => e.stopPropagation()}
              disabled={conversations.length === 0}
            />
            <span className="text-white">{title}</span>
            <span className="text-gray-400 text-xs">
              ({selectedCount}/{conversations.length})
            </span>
          </div>
          <Chevron className={cn(chevronClass, 'text-gray-400')} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">

        <div className="max-h-[180px] space-y-1 overflow-y-auto pr-2">
          {conversations.map((conversation) => (
            <label
              key={conversation.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-1 py-1.5 hover:bg-muted/50"
            >
              <Checkbox
                checked={selectedIds.has(conversation.id)}
                onCheckedChange={() => onToggle(conversation.id)}
              />
              {renderIcon ? renderIcon(conversation) : null}
              <span className="text-sm text-white">
                {renderLabel ? renderLabel(conversation) : conversation.name}
              </span>
            </label>
          ))}

          {conversations.length === 0 && (
            <p className="px-1 py-1.5 text-sm text-muted-foreground">{emptyMessage}</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
