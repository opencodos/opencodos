import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { filterConversationsBySearch } from '@/lib/conversationConfigUtils';

interface UseConversationCategoriesOptions<T extends { id: string; name: string }> {
  categories: Array<{
    key: string;
    conversations: T[];
    defaultOpen?: boolean;
  }>;
  initialSelectedIds?: Set<string>;
  loading: boolean;
}

/**
 * Hook for managing multi-category conversation selection with search
 * Works with any number of categories (Telegram: 3, Slack: 2, etc.)
 *
 * Uses a flat Set<string> for selections so IDs persist across pagination.
 * Saved IDs that haven't loaded yet still appear in allSelectedIds and
 * automatically show as checked when their conversations load via "Load more".
 */
export function useConversationCategories<T extends { id: string; name: string }>({
  categories: categoryDefinitions,
  initialSelectedIds = new Set(),
  loading,
}: UseConversationCategoriesOptions<T>) {
  const [searchQuery, setSearchQuery] = useState('');

  // Initialize category state
  const [categoryStates, setCategoryStates] = useState<Map<string, { isOpen: boolean }>>(
    new Map(categoryDefinitions.map((cat) => [cat.key, { isOpen: cat.defaultOpen ?? false }])),
  );

  // Flat set of all selected IDs (survives pagination — IDs not yet loaded are kept)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const prevInitialIdsRef = useRef<Set<string> | null>(null);

  // Build category data with filtered conversations
  const categories = useMemo(() => {
    return categoryDefinitions.map((cat) => {
      const filtered = filterConversationsBySearch(cat.conversations, searchQuery);
      const selectedCount = filtered.filter((c) => selected.has(c.id)).length;
      const allSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

      return {
        key: cat.key,
        conversations: cat.conversations,
        filtered,
        selected,
        selectedCount,
        allSelected,
        isOpen: categoryStates.get(cat.key)?.isOpen ?? false,
      };
    });
  }, [categoryDefinitions, searchQuery, selected, categoryStates]);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const hasAnySearchResults = categories.some((cat) => cat.filtered.length > 0);

  // All selected IDs (includes IDs not yet loaded via pagination)
  const allSelectedIds = useMemo(() => Array.from(selected), [selected]);

  // Toggle a single conversation
  const toggleConversation = useCallback((_categoryKey: string, conversationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  }, []);

  // Toggle all conversations in a category (respects current filter)
  const toggleAllInCategory = useCallback(
    (categoryKey: string) => {
      const category = categories.find((cat) => cat.key === categoryKey);
      if (!category || category.filtered.length === 0) return;

      setSelected((prev) => {
        const next = new Set(prev);
        if (category.allSelected) {
          category.filtered.forEach((c) => next.delete(c.id));
        } else {
          category.filtered.forEach((c) => next.add(c.id));
        }
        return next;
      });
    },
    [categories],
  );

  // Toggle category open/closed state
  const toggleCategoryOpen = useCallback((categoryKey: string) => {
    setCategoryStates((prev) => {
      const newMap = new Map(prev);
      const current = prev.get(categoryKey) ?? { isOpen: false };
      newMap.set(categoryKey, { isOpen: !current.isOpen });
      return newMap;
    });
  }, []);

  // Auto-expand all categories when searching
  useEffect(() => {
    if (hasSearchQuery) {
      setCategoryStates((prev) => {
        const newMap = new Map(prev);
        categoryDefinitions.forEach((cat) => {
          newMap.set(cat.key, { isOpen: true });
        });
        return newMap;
      });
    }
  }, [hasSearchQuery, categoryDefinitions]);

  // Initialize selection from saved IDs — re-syncs when new config arrives
  useEffect(() => {
    if (loading) return;
    if (initialSelectedIds.size === 0) return;
    // Only initialize if the IDs actually changed (new Set identity)
    if (prevInitialIdsRef.current === initialSelectedIds) return;
    prevInitialIdsRef.current = initialSelectedIds;
    setSelected(new Set(initialSelectedIds));
  }, [loading, initialSelectedIds]);

  return {
    searchQuery,
    setSearchQuery,
    categories,
    hasSearchQuery,
    hasAnySearchResults,
    allSelectedIds,
    toggleConversation,
    toggleAllInCategory,
    toggleCategoryOpen,
    selectionInitialized: prevInitialIdsRef.current !== null,
  };
}
