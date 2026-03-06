import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { User, DollarSign, Calendar, Building2 } from 'lucide-react';
import type { Contact } from './types';

interface ContactCardProps {
  contact: Contact;
  onClick: () => void;
  isDragging?: boolean;
}

function formatDealValue(value: number | null): string {
  if (!value) return '';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

function getRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Never';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Base card content - used both for the sortable card and drag overlay
export function ContactCardContent({ contact }: { contact: Contact; isDragging?: boolean }) {
  return (
    <div className="space-y-2">
      {/* Name & Company */}
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-gray-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white text-sm truncate">{contact.name}</p>
          {contact.company && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Building2 className="h-3 w-3" />
              <span className="truncate">{contact.company}</span>
            </div>
          )}
        </div>
      </div>

      {/* Deal Value */}
      {contact.deal_value && (
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5 text-green-400" />
          <span className="text-sm font-medium text-green-400">
            {formatDealValue(contact.deal_value)}
          </span>
        </div>
      )}

      {/* Next Step */}
      {contact.next_step && (
        <p className="text-xs text-gray-400 line-clamp-2">
          {truncateText(contact.next_step, 50)}
        </p>
      )}

      {/* Last Contact */}
      <div className="flex items-center gap-1 text-xs text-gray-500">
        <Calendar className="h-3 w-3" />
        <span>{getRelativeTime(contact.last_connection)}</span>
      </div>
    </div>
  );
}

// Sortable contact card with drag-and-drop
export function ContactCard({ contact, onClick, isDragging: externalIsDragging }: ContactCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: contact.id,
    data: {
      type: 'contact',
      contact,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCurrentlyDragging = isDragging || externalIsDragging;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`
        p-3 cursor-grab shadow-none bg-white/5 border-white/10
        hover:bg-white/10 hover:border-white/20 transition
        ${isCurrentlyDragging ? 'opacity-50 shadow-lg ring-2 ring-blue-500/50 cursor-grabbing' : ''}
      `}
      onClick={() => {
        // Only trigger click if not dragging
        if (!isCurrentlyDragging) {
          onClick();
        }
      }}
    >
      <ContactCardContent contact={contact} isDragging={isCurrentlyDragging} />
    </Card>
  );
}

// Non-draggable version for DragOverlay
export function ContactCardOverlay({ contact }: { contact: Contact }) {
  return (
    <Card className="p-3 cursor-grabbing shadow-xl bg-white/10 border-blue-500/50 ring-2 ring-blue-500/30 w-[256px]">
      <ContactCardContent contact={contact} isDragging />
    </Card>
  );
}
