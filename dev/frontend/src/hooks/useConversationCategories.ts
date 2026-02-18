import { useState, useMemo, useEffect, useCallback } from 'react';
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
 */
export function useConversationCategories<T extends { id: string; name: string }>({
  categories: categoryDefinitions,
  initialSelectedIds = new Set(),
  loading,
}: UseConversationCategoriesOptions<T>) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectionInitialized, setSelectionInitialized] = useState(false);

  // Initialize category state
  const [categoryStates, setCategoryStates] = useState<Map<string, { isOpen: boolean }>>(
    new Map(categoryDefinitions.map((cat) => [cat.key, { isOpen: cat.defaultOpen ?? false }])),
  );

  // Initialize selection state for each category
  const [selectedIds, setSelectedIds] = useState<Map<string, Set<string>>>(new Map());

  // Build category data with filtered conversations
  const categories = useMemo(() => {
    return categoryDefinitions.map((cat) => {
      const filtered = filterConversationsBySearch(cat.conversations, searchQuery);
      const selected = selectedIds.get(cat.key) ?? new Set<string>();
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
  }, [categoryDefinitions, searchQuery, selectedIds, categoryStates]);

  const hasSearchQuery = searchQuery.trim().length > 0;
  const hasAnySearchResults = categories.some((cat) => cat.filtered.length > 0);

  // Get all selected IDs across all categories
  const allSelectedIds = useMemo(() => {
    const ids: string[] = [];
    selectedIds.forEach((set) => {
      ids.push(...Array.from(set));
    });
    return ids;
  }, [selectedIds]);

  // Toggle a single conversation
  const toggleConversation = useCallback((categoryKey: string, conversationId: string) => {
    setSelectedIds((prev) => {
      const newMap = new Map(prev);
      const categorySet = new Set(prev.get(categoryKey) ?? []);

      if (categorySet.has(conversationId)) {
        categorySet.delete(conversationId);
      } else {
        categorySet.add(conversationId);
      }

      newMap.set(categoryKey, categorySet);
      return newMap;
    });
  }, []);

  // Toggle all conversations in a category (respects current filter)
  const toggleAllInCategory = useCallback(
    (categoryKey: string) => {
      const category = categories.find((cat) => cat.key === categoryKey);
      if (!category || category.filtered.length === 0) return;

      setSelectedIds((prev) => {
        const newMap = new Map(prev);
        if (category.allSelected) {
          // Deselect all filtered conversations
          const categorySet = new Set(prev.get(categoryKey) ?? []);
          category.filtered.forEach((c) => categorySet.delete(c.id));
          newMap.set(categoryKey, categorySet);
        } else {
          // Select all filtered conversations
          const categorySet = new Set(prev.get(categoryKey) ?? []);
          category.filtered.forEach((c) => categorySet.add(c.id));
          newMap.set(categoryKey, categorySet);
        }
        return newMap;
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

  // Initialize selection from saved IDs
  useEffect(() => {
    if (selectionInitialized) return;
    if (loading) return;
    if (categoryDefinitions.every((cat) => cat.conversations.length === 0)) return;

    const newSelectedIds = new Map<string, Set<string>>();

    categoryDefinitions.forEach((cat) => {
      const categoryIdSet = new Set(cat.conversations.map((c) => c.id));
      const categorySelection = Array.from(initialSelectedIds).filter((id) =>
        categoryIdSet.has(id),
      );
      newSelectedIds.set(cat.key, new Set(categorySelection));
    });

    setSelectedIds(newSelectedIds);
    setSelectionInitialized(true);
  }, [selectionInitialized, loading, categoryDefinitions, initialSelectedIds]);

  // Reset selection initialization when initialSelectedIds changes
  useEffect(() => {
    setSelectionInitialized(false);
  }, [initialSelectedIds]);

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
    selectionInitialized,
  };
}
