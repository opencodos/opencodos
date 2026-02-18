export interface Contact {
  id: string;
  name: string;
  company: string | null;
  relationship: string;
  hypothesis: string;
  last_connection: string | null;
  last_messages: { me: string | null; them: string | null };
  next_step: string | null;
  telegram_id: number | null;
  email: string | null;
  interactions_365d: number;
  sources: string[];
  auto_created: boolean;
  profile_path?: string;
  health_score?: number;
  health_trend?: string;
  // Pipeline fields
  type: string[]; // ["personal"] | ["client"] | ["investor"]
  deal_stage: string | null;
  deal_value: number | null;
}

export type DealStage = 'to_connect' | 'first_contact' | 'call' | 'negotiation' | 'closed_won' | 'closed_lost';
export type ContactType = 'personal' | 'client' | 'investor';

export const DEAL_STAGES: { value: DealStage; label: string }[] = [
  { value: 'to_connect', label: 'To Connect' },
  { value: 'first_contact', label: 'First Contact' },
  { value: 'call', label: 'Call' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
];

export const CONTACT_TYPES: { value: ContactType; label: string }[] = [
  { value: 'personal', label: 'Personal' },
  { value: 'client', label: 'Client' },
  { value: 'investor', label: 'Investor' },
];

export const RELATIONSHIP_TIERS: { value: string; label: string; color: string }[] = [
  { value: '5', label: 'Tier 5 - Closest', color: 'text-purple-400' },
  { value: '4', label: 'Tier 4 - Close', color: 'text-blue-400' },
  { value: '3', label: 'Tier 3 - Warm', color: 'text-green-400' },
  { value: '2', label: 'Tier 2 - Acquaintance', color: 'text-yellow-400' },
  { value: '1', label: 'Tier 1 - Distant', color: 'text-orange-400' },
  { value: '0', label: 'Tier 0 - New', color: 'text-gray-400' },
];
