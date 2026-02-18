import { useState, useEffect, useCallback } from 'react';
import type { Contact } from './types';
import { ActionItems } from './ActionItems';
import { ContactList } from './ContactList';
import { ContactDetailPanel } from './ContactDetailPanel';
import { PipelineBoard } from './PipelineBoard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Users, Search, RefreshCw, DollarSign } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8767';

function formatPipelineTotal(contacts: Contact[]): string {
  const total = contacts
    .filter((c) => c.type.includes('client') || c.type.includes('investor'))
    .filter((c) => c.deal_stage && !['closed_won', 'closed_lost'].includes(c.deal_stage))
    .reduce((sum, c) => sum + (c.deal_value || 0), 0);

  if (total === 0) return '$0';
  if (total >= 1000000) return `$${(total / 1000000).toFixed(1)}M`;
  if (total >= 1000) return `$${(total / 1000).toFixed(0)}K`;
  return `$${total}`;
}

export function CRMPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('personal');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const fetchContacts = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setError(null);
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      const response = await fetch(`${API_BASE_URL}/api/crm/contacts`);

      if (!response.ok) {
        throw new Error('Failed to fetch contacts');
      }

      const data: Contact[] = await response.json();
      setContacts(data);
    } catch (err) {
      console.error('Error fetching contacts:', err);
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load contacts');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Filter contacts based on search
  const filteredContacts = contacts.filter((contact) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      contact.name.toLowerCase().includes(query) ||
      contact.company?.toLowerCase().includes(query) ||
      contact.email?.toLowerCase().includes(query)
    );
  });

  // Categorize contacts
  const personalContacts = filteredContacts.filter(
    (c) => c.type.includes('personal') && !c.type.includes('client') && !c.type.includes('investor')
  );
  const clientContacts = filteredContacts.filter((c) => c.type.includes('client'));
  const investorContacts = filteredContacts.filter((c) => c.type.includes('investor'));

  const handleContactClick = (contact: Contact) => {
    setSelectedContact(contact);
  };

  const handleContactUpdate = (updatedContact: Contact) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === updatedContact.id ? updatedContact : c))
    );
    setSelectedContact(updatedContact);
  };

  // Handler for pipeline board drag-and-drop stage updates
  const handlePipelineUpdate = async (contactId: string, updates: Partial<Contact>) => {
    const response = await fetch(`${API_BASE_URL}/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error('Failed to update contact');
    }

    const updatedContact: Contact = await response.json();

    // Update local state
    setContacts((prev) =>
      prev.map((c) => (c.id === updatedContact.id ? updatedContact : c))
    );

    // Update selected contact if it's the same one
    if (selectedContact?.id === updatedContact.id) {
      setSelectedContact(updatedContact);
    }
  };

  const handleViewAllActions = () => {
    // For now, just switch to personal tab which shows all contacts
    setActiveTab('personal');
  };

  // Loading state
  if (loading) {
    return (
      <div className="w-full h-full overflow-auto bg-[#0a0a0f] min-h-screen">
        <div className="p-6 space-y-6">
          {/* Header skeleton */}
          <div className="space-y-2">
            <Skeleton className="h-8 w-8 bg-white/10" />
            <Skeleton className="h-8 w-48 bg-white/10" />
          </div>

          {/* Action items skeleton */}
          <div className="space-y-3">
            <Skeleton className="h-5 w-32 bg-white/10" />
            <div className="flex gap-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-[280px] bg-white/10 rounded-xl" />
              ))}
            </div>
          </div>

          {/* Tabs skeleton */}
          <Skeleton className="h-10 w-96 bg-white/10" />

          {/* Content skeleton */}
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full bg-white/10 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-[#0a0a0f] min-h-screen">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (window.location.hash = '#/agents')}
            className="gap-2 -ml-2 text-gray-400 hover:text-white hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>

          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Users className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold text-white">CRM</h1>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-green-500/10 border border-green-500/20">
                    <DollarSign className="h-4 w-4 text-green-400" />
                    <span className="text-sm font-medium text-green-400">
                      {formatPipelineTotal(contacts)}
                    </span>
                    <span className="text-xs text-gray-500">pipeline</span>
                  </div>
                </div>
                <p className="text-sm text-gray-500">{contacts.length} contacts</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-[200px] bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500/50 transition"
                />
              </div>

              {/* Refresh */}
              <Button
                variant="outline"
                onClick={() => fetchContacts(true)}
                disabled={refreshing}
                className="gap-2 border-white/10 text-gray-300 hover:bg-white/5 hover:text-white"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Error alert */}
        {error && (
          <div className="p-4 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400">
            {error}
          </div>
        )}

        {/* Action Items */}
        <ActionItems
          contacts={filteredContacts}
          onContactClick={handleContactClick}
          onViewAll={handleViewAllActions}
        />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white/5 border border-white/10 rounded-lg p-1 h-10">
            <TabsTrigger
              value="personal"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-4 py-1.5"
            >
              Personal ({personalContacts.length})
            </TabsTrigger>
            <TabsTrigger
              value="clients"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-4 py-1.5"
            >
              Clients ({clientContacts.length})
            </TabsTrigger>
            <TabsTrigger
              value="investors"
              className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-gray-400 shadow-none rounded-md px-4 py-1.5"
            >
              Investors ({investorContacts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="mt-4">
            <ContactList contacts={personalContacts} onContactClick={handleContactClick} />
          </TabsContent>

          <TabsContent value="clients" className="mt-4">
            <PipelineBoard
              contacts={clientContacts}
              onContactClick={handleContactClick}
              onContactUpdate={handlePipelineUpdate}
            />
          </TabsContent>

          <TabsContent value="investors" className="mt-4">
            <PipelineBoard
              contacts={investorContacts}
              onContactClick={handleContactClick}
              onContactUpdate={handlePipelineUpdate}
            />
          </TabsContent>
        </Tabs>

        {/* Empty state */}
        {filteredContacts.length === 0 && !loading && !error && (
          <div className="text-center py-12">
            <Users className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">
              {searchQuery ? 'No contacts match your search.' : 'No contacts found.'}
            </p>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {selectedContact && (
        <ContactDetailPanel
          contact={selectedContact}
          onClose={() => setSelectedContact(null)}
          onUpdate={handleContactUpdate}
        />
      )}
    </div>
  );
}
