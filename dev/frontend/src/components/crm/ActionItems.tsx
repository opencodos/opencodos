import type { Contact } from './types';
import { DEAL_STAGES } from './types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { ChevronRight, DollarSign, User } from 'lucide-react';

interface ActionItemsProps {
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
  onViewAll: () => void;
}

function formatDealValue(value: number | null): string {
  if (!value) return '';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

function getRelativeTime(dateString: string | null): string | null {
  if (!dateString) return null;

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function getStageBadgeColor(stage: string | null): string {
  switch (stage) {
    case 'to_connect':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'first_contact':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'call':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'negotiation':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'closed_won':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'closed_lost':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    default:
      return 'bg-white/10 text-gray-400 border-white/20';
  }
}

function getTypeBadge(types: string[]): { label: string; color: string } {
  if (types.includes('investor')) return { label: 'Investor', color: 'bg-purple-500/20 text-purple-400' };
  if (types.includes('client')) return { label: 'Client', color: 'bg-green-500/20 text-green-400' };
  return { label: 'Personal', color: 'bg-blue-500/20 text-blue-400' };
}

export function ActionItems({ contacts, onContactClick, onViewAll }: ActionItemsProps) {
  // Sort contacts by priority:
  // 1. Deal value descending
  // 2. Relationship tier descending (extract number from relationship string)
  // 3. Last contact ascending (oldest first)
  const sortedContacts = [...contacts]
    .filter((c) => c.next_step)
    .sort((a, b) => {
      // Deal value (higher first)
      const aValue = a.deal_value || 0;
      const bValue = b.deal_value || 0;
      if (bValue !== aValue) return bValue - aValue;

      // Relationship tier (higher first)
      const aTier = parseInt(a.relationship.match(/\d+/)?.[0] || '0');
      const bTier = parseInt(b.relationship.match(/\d+/)?.[0] || '0');
      if (bTier !== aTier) return bTier - aTier;

      // Last contact (oldest first to prioritize follow-ups)
      const aDate = a.last_connection ? new Date(a.last_connection).getTime() : 0;
      const bDate = b.last_connection ? new Date(b.last_connection).getTime() : 0;
      return aDate - bDate;
    })
    .slice(0, 10);

  if (sortedContacts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
          Action Items ({sortedContacts.length})
        </h2>
        {contacts.filter((c) => c.next_step).length > 6 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="text-gray-400 hover:text-white"
          >
            View All
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>

      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex gap-3 pb-2">
          {sortedContacts.slice(0, 6).map((contact) => {
            const typeBadge = getTypeBadge(contact.type);
            const stageLabel = DEAL_STAGES.find((s) => s.value === contact.deal_stage)?.label;

            return (
              <Card
                key={contact.id}
                className="min-w-[280px] max-w-[320px] p-4 cursor-pointer shadow-none bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition"
                onClick={() => onContactClick(contact)}
              >
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                        <User className="h-4 w-4 text-gray-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">{contact.name}</p>
                        {contact.company && (
                          <p className="text-xs text-gray-500 truncate">{contact.company}</p>
                        )}
                      </div>
                    </div>
                    <Badge className={`${typeBadge.color} text-xs flex-shrink-0`}>
                      {typeBadge.label}
                    </Badge>
                  </div>

                  {/* Deal info */}
                  {(contact.deal_value || contact.deal_stage) && (
                    <div className="flex items-center gap-2">
                      {contact.deal_value && (
                        <div className="flex items-center gap-1 text-green-400">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span className="text-sm font-medium">
                            {formatDealValue(contact.deal_value)}
                          </span>
                        </div>
                      )}
                      {stageLabel && (
                        <Badge className={`${getStageBadgeColor(contact.deal_stage)} text-xs`}>
                          {stageLabel}
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Next step */}
                  <p className="text-sm text-gray-300 whitespace-normal line-clamp-2">
                    {contact.next_step}
                  </p>

                  {/* Last contact */}
                  {contact.last_connection && (
                    <p className="text-xs text-gray-500">
                      Last contact: {getRelativeTime(contact.last_connection)}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
