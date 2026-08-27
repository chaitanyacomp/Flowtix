import * as React from "react";
import { Link } from "react-router-dom";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { NativeSelect } from "../ui/native-select";
import { PageContainer, StickyWorkspaceHead } from "../PageHeader";
import { ERPBackNavigation } from "../erp/foundation/ERPBackNavigation";
import { cn } from "../../lib/utils";
import { MASTERS_LANDING_PATH, MASTER_PAGE_SIZES, resultCountLabel } from "../../lib/masterListQuery";

export function MasterStatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold",
        active ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function MasterTypeBadge({ type }: { type: string }) {
  const t = String(type || "").toUpperCase();
  const tone =
    t === "FG"
      ? "border-indigo-200 bg-indigo-50 text-indigo-900"
      : t === "RM"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : t === "SFG"
          ? "border-sky-200 bg-sky-50 text-sky-900"
          : t === "CONSUMABLE"
            ? "border-violet-200 bg-violet-50 text-violet-900"
            : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={cn("inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold", tone)}>{t || "—"}</span>;
}

type HeaderProps = {
  title: string;
  description: string;
  /** Hide back when already on Masters landing */
  showBack?: boolean;
  actions?: React.ReactNode;
};

export function MasterListHeader({ title, description, showBack = true, actions }: HeaderProps) {
  return (
    <StickyWorkspaceHead
      lead={
        showBack ? (
          <ERPBackNavigation to={MASTERS_LANDING_PATH} label="Back to Masters" data-testid="master-back-to-masters" />
        ) : null
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900" data-testid="master-list-title">
            {title}
          </h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-600" data-testid="master-list-description">
            {description}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </StickyWorkspaceHead>
  );
}

type SearchProps = {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  placeholder: string;
  "aria-label"?: string;
};

export function MasterSearchInput({ value, onChange, onClear, placeholder, ...rest }: SearchProps) {
  return (
    <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
      <Input
        type="search"
        value={value}
        placeholder={placeholder}
        className="h-9 pl-8 pr-8 text-sm"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClear();
          }
        }}
        aria-label={rest["aria-label"] || placeholder}
        data-testid="master-search-input"
      />
      {value ? (
        <button
          type="button"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          onClick={onClear}
          aria-label="Clear search"
          data-testid="master-search-clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

type ToolbarProps = {
  search: React.ReactNode;
  filters?: React.ReactNode;
  resultLabel: string;
  onClearFilters?: () => void;
  showClearFilters?: boolean;
  bulkBar?: React.ReactNode;
};

export function MasterListToolbar({
  search,
  filters,
  resultLabel,
  onClearFilters,
  showClearFilters,
  bulkBar,
}: ToolbarProps) {
  return (
    <div className="mb-3 space-y-2">
      {bulkBar}
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
        data-testid="master-list-toolbar"
      >
        {search}
        {filters}
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="tabular-nums" data-testid="master-result-count">
            {resultLabel}
          </span>
          {showClearFilters && onClearFilters ? (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onClearFilters} data-testid="master-clear-filters">
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type BulkBarProps = {
  selectedCount: number;
  onClear: () => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  entityLabel: string;
};

export function MasterBulkActionBar({
  selectedCount,
  onClear,
  onActivate,
  onDeactivate,
  onDelete,
  busy,
  entityLabel,
}: BulkBarProps) {
  if (selectedCount <= 0) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
      data-testid="master-bulk-action-bar"
      role="region"
      aria-label="Bulk actions"
    >
      <div className="text-slate-800">
        <span className="font-semibold tabular-nums">{selectedCount}</span> {entityLabel} selected
        <span className="ml-2 text-xs text-slate-500">(current page)</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onActivate ? (
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={onActivate} disabled={busy}>
            Activate
          </Button>
        ) : null}
        {onDeactivate ? (
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={onDeactivate} disabled={busy}>
            Deactivate
          </Button>
        ) : null}
        {onDelete ? (
          <Button type="button" variant="destructive" size="sm" className="h-9" onClick={onDelete} disabled={busy}>
            Delete
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onClear} disabled={busy}>
          Clear selection
        </Button>
      </div>
    </div>
  );
}

type PaginationProps = {
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
};

export function MasterListPagination({
  page,
  pageSize,
  totalPages,
  from,
  to,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600"
      data-testid="master-list-pagination"
    >
      <div className="tabular-nums">
        {total === 0 ? "No records" : `Showing ${from}–${to} of ${total.toLocaleString("en-IN")}`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <NativeSelect
            className="h-8 w-[4.5rem] py-0 text-xs"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {MASTER_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">
          Page {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function MasterTableShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("erp-table-wrap overflow-x-auto rounded-md border border-slate-200", className)}>
      <table className="erp-table w-full min-w-[720px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function MasterTableSkeleton({ cols = 6, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <tbody data-testid="master-table-skeleton">
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-2 py-3">
              <div className="h-3 w-full max-w-[8rem] animate-pulse rounded bg-slate-200" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function MasterEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center" data-testid="master-empty-state">
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function MasterNoResultsState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center" data-testid="master-no-results">
      <div className="text-sm font-medium text-slate-900">No items match “{query}”</div>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onClear}>
        Clear search / filters
      </Button>
    </div>
  );
}

export function MasterErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="master-error-state">
      <div>{message}</div>
      <Button type="button" variant="outline" size="sm" className="mt-2 h-8 border-red-300" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function MasterListPageShell({ children }: { children: React.ReactNode }) {
  return <PageContainer className="space-y-3">{children}</PageContainer>;
}

/** Sticky thead cell styles for master grids. */
export const masterThClass =
  "sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600";

export const masterTdClass = "border-b border-slate-100 px-2 py-[0.65rem] align-middle text-sm text-slate-800";

export function MasterSortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  className,
}: {
  label: string;
  sortKey: string;
  activeKey: string;
  dir: "asc" | "desc";
  onToggle: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th className={cn(masterThClass, className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded text-left hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-400"
        onClick={() => onToggle(sortKey)}
        aria-label={`Sort by ${label}${active ? `, currently ${dir === "asc" ? "ascending" : "descending"}` : ""}`}
        data-testid={`master-sort-${sortKey}`}
      >
        {label}
        {active ? <span className="text-[10px] tabular-nums text-slate-500">{dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

export function MasterSelectAllCheckbox({
  checked,
  indeterminate,
  inputRef,
  onChange,
  disabled,
}: {
  checked: boolean;
  indeterminate: boolean;
  inputRef: React.RefObject<HTMLInputElement | null> | React.MutableRefObject<HTMLInputElement | null>;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <th className={cn(masterThClass, "w-10 text-center")}>
      <input
        ref={inputRef as React.Ref<HTMLInputElement>}
        type="checkbox"
        className="h-4 w-4 accent-slate-800"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label="Select all rows on this page"
        data-testid="master-select-all"
        // indeterminate is set via ref effect in useBulkSelection
        title={indeterminate ? "Some rows selected" : checked ? "Deselect all on this page" : "Select all on this page"}
      />
    </th>
  );
}

export function MasterRowCheckbox({
  id,
  checked,
  onChange,
  label,
}: {
  id: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <td className={cn(masterTdClass, "w-10 text-center")} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        className="h-4 w-4 accent-slate-800"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={`Select ${label}`}
        data-testid={`master-row-select-${id}`}
      />
    </td>
  );
}

export function MasterTruncatedCell({ text, className }: { text: string; className?: string }) {
  const display = text?.trim() || "—";
  return (
    <td className={cn(masterTdClass, "max-w-[14rem] truncate font-medium", className)} title={display === "—" ? undefined : display}>
      {display}
    </td>
  );
}

export function mastersHubLinkClassName(active?: boolean) {
  return cn("text-sm font-medium text-slate-700 hover:text-slate-900", active && "text-slate-900");
}

export function MasterReadOnlyField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 text-[11px]">
      <span className="font-medium text-slate-500">{label}</span>
      <div className="text-sm font-medium text-slate-900">{value ?? "—"}</div>
    </div>
  );
}

export function MasterReadOnlyPlaceholder({ entityLabel }: { entityLabel: string }) {
  return (
    <p className="text-sm text-slate-500" data-testid="master-read-only-placeholder">
      Select a {entityLabel} to view details.
    </p>
  );
}

export { resultCountLabel, MASTERS_LANDING_PATH, Link };
