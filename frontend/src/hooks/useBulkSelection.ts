import * as React from "react";

/**
 * Multi-select for numeric row ids; keeps selection aligned when rows refresh.
 */
export function useBulkSelection(rowIds: readonly number[]) {
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => new Set());
  const selectAllRef = React.useRef<HTMLInputElement | null>(null);

  const rowIdSet = React.useMemo(() => new Set(rowIds), [rowIds]);
  const selectedOnPage = React.useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      if (rowIdSet.has(id)) n += 1;
    }
    return n;
  }, [selectedIds, rowIdSet]);

  const selectedCount = selectedOnPage;
  const allSelected = rowIds.length > 0 && selectedCount === rowIds.length;
  const someSelected = selectedCount > 0 && selectedCount < rowIds.length;

  React.useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (rowIdSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rowIdSet]);

  function toggleSelectAll(nextChecked: boolean) {
    setSelectedIds(() => (nextChecked ? new Set(rowIds) : new Set()));
  }

  function toggleOne(id: number, nextChecked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextChecked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clear() {
    setSelectedIds(new Set());
  }

  function getSelectedIdsArray(): number[] {
    return Array.from(selectedIds).filter((id) => rowIdSet.has(id));
  }

  return {
    selectedIds,
    selectedCount,
    allSelected,
    someSelected,
    selectAllRef,
    toggleSelectAll,
    toggleOne,
    clear,
    getSelectedIdsArray,
  };
}
