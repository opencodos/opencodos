import { useState, useEffect } from 'react';
import type { Contact } from './types';
import { DEAL_STAGES, CONTACT_TYPES, RELATIONSHIP_TIERS } from './types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  X,
  User,
  Building2,
  Mail,
  MessageCircle,
  Calendar,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Edit2,
  Check,
  ArrowRight,
  FileText,
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767';

interface ContactDetailPanelProps {
  contact: Contact;
  onClose: () => void;
  onUpdate: (contact: Contact) => void;
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
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatDealValue(value: number | null): string {
  if (!value) return '$0';
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
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

function HealthTrendIcon({ trend }: { trend: string | undefined }) {
  if (trend === 'improving') {
    return <TrendingUp className="h-4 w-4 text-green-400" />;
  }
  if (trend === 'declining') {
    return <TrendingDown className="h-4 w-4 text-red-400" />;
  }
  return <Minus className="h-4 w-4 text-gray-400" />;
}

export function ContactDetailPanel({ contact, onClose, onUpdate }: ContactDetailPanelProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [localContact, setLocalContact] = useState<Contact>(contact);
  const [profileContent, setProfileContent] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Sync with prop changes
  useEffect(() => {
    setLocalContact(contact);
  }, [contact]);

  // Load profile content if available
  useEffect(() => {
    if (contact.profile_path) {
      setLoadingProfile(true);
      // Try to load the profile file via API
      fetch(`${API_BASE_URL}/api/crm/profile?path=${encodeURIComponent(contact.profile_path)}`)
        .then((res) => (res.ok ? res.text() : null))
        .then((content) => {
          setProfileContent(content);
          setLoadingProfile(false);
        })
        .catch(() => {
          setLoadingProfile(false);
        });
    }
  }, [contact.profile_path]);

  const handleFieldSave = async (field: string, value: unknown) => {
    const updated = { ...localContact, [field]: value };
    setLocalContact(updated);
    setEditingField(null);

    // Save to API
    try {
      const res = await fetch(`${API_BASE_URL}/api/crm/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const updatedContact = await res.json();
        onUpdate(updatedContact);
      }
    } catch (err) {
      console.error('Failed to update contact:', err);
    }
  };

  const tier = localContact.relationship.match(/(\d+)/)?.[1] || '0';
  const tierInfo = RELATIONSHIP_TIERS.find((t) => t.value === tier);
  const stageInfo = DEAL_STAGES.find((s) => s.value === localContact.deal_stage);

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-[#0d0d14] border-l border-white/10 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-white/10 flex items-center justify-center">
            <User className="h-6 w-6 text-gray-400" />
          </div>
          <div>
            {editingField === 'name' ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  defaultValue={localContact.name}
                  className="h-8 w-[200px] bg-white/5 border-white/10 text-white text-lg font-semibold"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleFieldSave('name', (e.target as HTMLInputElement).value);
                    }
                    if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  onBlur={(e) => handleFieldSave('name', e.target.value)}
                />
              </div>
            ) : (
              <h2
                className="text-lg font-semibold text-white cursor-pointer hover:text-blue-400 flex items-center gap-2"
                onClick={() => setEditingField('name')}
              >
                {localContact.name}
                <Edit2 className="h-3.5 w-3.5 text-gray-500 hover:text-white" />
              </h2>
            )}
            {editingField === 'company' ? (
              <div className="flex items-center gap-1 mt-1">
                <Building2 className="h-3.5 w-3.5 text-gray-500" />
                <Input
                  autoFocus
                  defaultValue={localContact.company || ''}
                  placeholder="Company"
                  className="h-6 w-[180px] bg-white/5 border-white/10 text-white text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleFieldSave('company', (e.target as HTMLInputElement).value || null);
                    }
                    if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  onBlur={(e) => handleFieldSave('company', e.target.value || null)}
                />
              </div>
            ) : (
              <div
                className="flex items-center gap-1 text-sm text-gray-400 cursor-pointer hover:text-blue-400 mt-1"
                onClick={() => setEditingField('company')}
              >
                <Building2 className="h-3.5 w-3.5" />
                <span>{localContact.company || 'Add company'}</span>
                <Edit2 className="h-3 w-3 text-gray-500" />
              </div>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Contact Info */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Contact Info
            </h3>
            <div className="space-y-2">
              {/* Email - editable */}
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-500" />
                {editingField === 'email' ? (
                  <Input
                    autoFocus
                    type="email"
                    defaultValue={localContact.email || ''}
                    placeholder="email@example.com"
                    className="h-7 w-[200px] bg-white/5 border-white/10 text-white text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleFieldSave('email', (e.target as HTMLInputElement).value || null);
                      }
                      if (e.key === 'Escape') {
                        setEditingField(null);
                      }
                    }}
                    onBlur={(e) => handleFieldSave('email', e.target.value || null)}
                  />
                ) : (
                  <span
                    className="text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                    onClick={() => setEditingField('email')}
                  >
                    {localContact.email || 'Add email'}
                    <Edit2 className="h-3 w-3 text-gray-500" />
                  </span>
                )}
              </div>
              {localContact.telegram_id && (
                <div className="flex items-center gap-2 text-sm">
                  <MessageCircle className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-300">Telegram ID: {localContact.telegram_id}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-gray-300">
                  Last contact: {getRelativeTime(localContact.last_connection)}
                </span>
              </div>
            </div>
          </section>

          {/* Relationship */}
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Relationship
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Tier</span>
                {editingField === 'relationship' ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={tier}
                      onValueChange={(val) => {
                        const tierLabel = RELATIONSHIP_TIERS.find(t => t.value === val)?.label || `${val} - Unknown`;
                        handleFieldSave('relationship', tierLabel);
                      }}
                    >
                      <SelectTrigger className="w-[180px] bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a24] border-white/10">
                        {RELATIONSHIP_TIERS.map((t) => (
                          <SelectItem
                            key={t.value}
                            value={t.value}
                            className="text-white hover:bg-white/10"
                          >
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingField(null)}
                      className="h-9"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge
                      className={`${getTierBadgeColor(tier)} cursor-pointer`}
                      onClick={() => setEditingField('relationship')}
                    >
                      {tierInfo?.label || `Tier ${tier}`}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingField('relationship')}
                      className="h-6 w-6 p-0 text-gray-400 hover:text-white hover:bg-white/10"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {localContact.health_score !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Health Score</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{localContact.health_score}</span>
                    <HealthTrendIcon trend={localContact.health_trend} />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Interactions (1y)</span>
                <span className="text-white">{localContact.interactions_365d}</span>
              </div>
            </div>
          </section>

          {/* Type */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Type</h3>
              {editingField !== 'type' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingField('type')}
                  className="h-7 text-xs text-gray-400"
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            {editingField === 'type' ? (
              <div className="flex items-center gap-2">
                <Select
                  value={localContact.type[0] || 'personal'}
                  onValueChange={(val) => handleFieldSave('type', [val])}
                >
                  <SelectTrigger className="flex-1 bg-white/5 border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a24] border-white/10">
                    {CONTACT_TYPES.map((type) => (
                      <SelectItem
                        key={type.value}
                        value={type.value}
                        className="text-white hover:bg-white/10"
                      >
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingField(null)}
                  className="h-9"
                >
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {localContact.type.map((t) => (
                  <Badge key={t} className="bg-white/10 text-white">
                    {CONTACT_TYPES.find((ct) => ct.value === t)?.label || t}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/* Deal Info */}
          {(localContact.type.includes('client') || localContact.type.includes('investor')) && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Deal Info
              </h3>
              <div className="space-y-3">
                {/* Stage */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Stage</span>
                  {editingField === 'deal_stage' ? (
                    <div className="flex items-center gap-2">
                      <Select
                        value={localContact.deal_stage || ''}
                        onValueChange={(val) => handleFieldSave('deal_stage', val || null)}
                      >
                        <SelectTrigger className="w-[160px] bg-white/5 border-white/10 text-white">
                          <SelectValue placeholder="Select stage" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a24] border-white/10">
                          {DEAL_STAGES.map((stage) => (
                            <SelectItem
                              key={stage.value}
                              value={stage.value}
                              className="text-white hover:bg-white/10"
                            >
                              {stage.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField(null)}
                        className="h-9"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-white cursor-pointer hover:text-blue-400" onClick={() => setEditingField('deal_stage')}>{stageInfo?.label || 'Not set'}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField('deal_stage')}
                        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/10"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Value */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Deal Value</span>
                  {editingField === 'deal_value' ? (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                        <Input
                          type="number"
                          defaultValue={localContact.deal_value || ''}
                          className="w-[120px] pl-7 bg-white/5 border-white/10 text-white"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const value = parseInt((e.target as HTMLInputElement).value) || null;
                              handleFieldSave('deal_value', value);
                            }
                          }}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField(null)}
                        className="h-9"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 font-medium cursor-pointer hover:text-green-300" onClick={() => setEditingField('deal_value')}>
                        {formatDealValue(localContact.deal_value)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingField('deal_value')}
                        className="h-7 w-7 p-0 text-gray-400 hover:text-white hover:bg-white/10"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Next Step - always show, editable */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Next Step
              </h3>
              {editingField !== 'next_step' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingField('next_step')}
                  className="h-7 text-xs text-gray-400"
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            {editingField === 'next_step' ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  defaultValue={localContact.next_step || ''}
                  placeholder="What's the next action for this contact?"
                  className="w-full h-20 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm resize-none focus:outline-none focus:border-orange-500/50"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.metaKey) {
                      handleFieldSave('next_step', (e.target as HTMLTextAreaElement).value || null);
                    }
                    if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingField(null)}
                    className="h-7 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
                      handleFieldSave('next_step', textarea?.value || null);
                    }}
                    className="h-7 text-xs bg-orange-500 hover:bg-orange-600"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : localContact.next_step ? (
              <div
                className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 cursor-pointer hover:bg-orange-500/20"
                onClick={() => setEditingField('next_step')}
              >
                <ArrowRight className="h-4 w-4 text-orange-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-orange-200">{localContact.next_step}</p>
              </div>
            ) : (
              <p
                className="text-sm text-gray-500 cursor-pointer hover:text-gray-400"
                onClick={() => setEditingField('next_step')}
              >
                No next step defined. Click to add one.
              </p>
            )}
          </section>

          {/* Hypothesis - always show, editable */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Hypothesis
              </h3>
              {editingField !== 'hypothesis' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingField('hypothesis')}
                  className="h-7 text-xs text-gray-400"
                >
                  <Edit2 className="h-3 w-3 mr-1" />
                  Edit
                </Button>
              )}
            </div>
            {editingField === 'hypothesis' ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  defaultValue={localContact.hypothesis || ''}
                  placeholder="Why is this person valuable?"
                  className="flex-1 bg-white/5 border-white/10 text-white"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleFieldSave('hypothesis', (e.target as HTMLInputElement).value || null);
                    }
                    if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  onBlur={(e) => handleFieldSave('hypothesis', e.target.value || null)}
                />
              </div>
            ) : (
              <p
                className="text-sm text-gray-300 cursor-pointer hover:text-white"
                onClick={() => setEditingField('hypothesis')}
              >
                {localContact.hypothesis || 'Click to add hypothesis'}
              </p>
            )}
          </section>

          {/* Recent Messages */}
          {(localContact.last_messages.me || localContact.last_messages.them) && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Recent Messages
              </h3>
              <div className="space-y-3">
                {localContact.last_messages.them && (
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-gray-500 mb-1">From {localContact.name}</p>
                    <p className="text-sm text-gray-300">{localContact.last_messages.them}</p>
                  </div>
                )}
                {localContact.last_messages.me && (
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-400 mb-1">Your reply</p>
                    <p className="text-sm text-gray-300">{localContact.last_messages.me}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Profile Notes */}
          {contact.profile_path && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                  Profile Notes
                </h3>
                <a
                  href={`vscode://file${contact.profile_path}`}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                >
                  <FileText className="h-3 w-3" />
                  Open in VS Code
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              {loadingProfile ? (
                <div className="animate-pulse bg-white/5 rounded-lg h-24" />
              ) : profileContent ? (
                <div className="p-3 rounded-lg bg-white/5 border border-white/10 max-h-[200px] overflow-y-auto">
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans">
                    {profileContent}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Profile not available</p>
              )}
            </section>
          )}

          {/* Sources */}
          {localContact.sources.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                Sources
              </h3>
              <div className="flex flex-wrap gap-2">
                {localContact.sources.map((source) => (
                  <Badge key={source} variant="secondary" className="bg-white/5 text-gray-400">
                    {source}
                  </Badge>
                ))}
              </div>
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
