import { useState, useMemo } from 'react';
import type { Contact } from './types';
import { RELATIONSHIP_TIERS } from './types';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { User, Building2, Calendar, ArrowRight } from 'lucide-react';

interface ContactListProps {
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
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

function getTierFromRelationship(relationship: string): string {
  const match = relationship.match(/(\d+)/);
  return match ? match[1] : '0';
}

function getTierBadgeColor(tier: string): string {
  switch (tier) {
    case '5':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case '4':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case '3':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case '2':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case '1':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    default:
      return 'bg-white/10 text-gray-400 border-white/20';
  }
}

function getTierLabel(tier: string): string {
  const tierInfo = RELATIONSHIP_TIERS.find((t) => t.value === tier);
  return tierInfo ? tierInfo.label : `Tier ${tier}`;
}

export function ContactList({ contacts, onContactClick }: ContactListProps) {
  const [filterTier, setFilterTier] = useState<string>('all');

  // Group contacts by tier
  const groupedContacts = useMemo(() => {
    const filtered =
      filterTier === 'all'
        ? contacts
        : contacts.filter((c) => getTierFromRelationship(c.relationship) === filterTier);

    // Group by tier
    const groups: Record<string, Contact[]> = {};
    filtered.forEach((contact) => {
      const tier = getTierFromRelationship(contact.relationship);
      if (!groups[tier]) groups[tier] = [];
      groups[tier].push(contact);
    });

    // Sort groups by tier (highest first) and contacts within groups by name
    const sortedGroups: { tier: string; contacts: Contact[] }[] = [];
    ['5', '4', '3', '2', '1', '0'].forEach((tier) => {
      if (groups[tier]) {
        sortedGroups.push({
          tier,
          contacts: groups[tier].sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    });

    return sortedGroups;
  }, [contacts, filterTier]);

  const totalCount = contacts.length;
  const filteredCount = groupedContacts.reduce((acc, g) => acc + g.contacts.length, 0);

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          {filterTier === 'all'
            ? `${totalCount} contacts`
            : `${filteredCount} of ${totalCount} contacts`}
        </p>
        <Select value={filterTier} onValueChange={setFilterTier}>
          <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
            <SelectValue placeholder="Filter by tier" />
          </SelectTrigger>
          <SelectContent className="bg-[#1a1a24] border-white/10">
            <SelectItem value="all" className="text-white hover:bg-white/10">
              All Tiers
            </SelectItem>
            {RELATIONSHIP_TIERS.map((tier) => (
              <SelectItem
                key={tier.value}
                value={tier.value}
                className="text-white hover:bg-white/10"
              >
                {tier.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Contact Groups */}
      <div className="space-y-6">
        {groupedContacts.map((group) => (
          <div key={group.tier} className="space-y-2">
            {/* Tier Header */}
            <div className="flex items-center gap-2 py-2 border-b border-white/10">
              <Badge className={`${getTierBadgeColor(group.tier)}`}>
                Tier {group.tier}
              </Badge>
              <span className="text-sm text-gray-500">
                {getTierLabel(group.tier).split(' - ')[1]} ({group.contacts.length})
              </span>
            </div>

            {/* Contact Rows */}
            <div className="space-y-1">
              {group.contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.02] hover:bg-white/5 cursor-pointer transition group"
                  onClick={() => onContactClick(contact)}
                >
                  {/* Avatar */}
                  <div className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>

                  {/* Name & Company */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{contact.name}</p>
                    {contact.company && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">{contact.company}</span>
                      </div>
                    )}
                  </div>

                  {/* Last Contact */}
                  <div className="hidden sm:flex items-center gap-1.5 text-sm text-gray-400 flex-shrink-0 w-24">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{getRelativeTime(contact.last_connection)}</span>
                  </div>

                  {/* Next Step */}
                  <div className="hidden md:flex items-center gap-1.5 text-sm text-gray-400 flex-shrink-0 max-w-[200px]">
                    {contact.next_step ? (
                      <>
                        <ArrowRight className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
                        <span className="truncate">{contact.next_step}</span>
                      </>
                    ) : (
                      <span className="text-gray-600">No action</span>
                    )}
                  </div>

                  {/* Arrow indicator */}
                  <ArrowRight className="h-4 w-4 text-gray-600 group-hover:text-gray-400 transition flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {groupedContacts.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No contacts found matching your filter.</p>
        </div>
      )}
    </div>
  );
}
