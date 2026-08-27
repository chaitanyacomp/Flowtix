import * as React from "react";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { DecimalInput } from "../components/ui/DecimalInput";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { Pencil, Trash2 } from "lucide-react";
import { normalizeMasterNameDisplay, normalizeMasterNameKey } from "../lib/masterNameNormalize";
import { BulkDeleteConfirmModal } from "../components/masters/BulkDeleteConfirmModal";
import { ItemStockStatusBadge } from "../components/erp/ItemStockStatusBadge";
import { itemStockStatusFromItemFields, parseItemQtyStr, type ItemStockStatus } from "../lib/itemStockStatus";
import { ErpModal } from "../components/erp/ErpModal";
import { ErpModalFrame, ErpModalFrameBody, ErpModalFrameFooter } from "../components/erp/ErpModalFrame";
import { DependencyLifecycleModal, type DependencySummary } from "../components/masters/DependencyLifecycleModal";
import { useUnsavedChangesGuard } from "../hooks/useUnsavedChangesGuard";
import { confirmLeaveIfDirty } from "../lib/unsavedChangesPolicy";
import { snapshotItemForm } from "../lib/itemMasterDirtySnapshot";
import { showIssueIncrementOnItemMaster } from "../lib/rmIssueRounding";
import { useListScrollRestoration } from "../hooks/useListScrollRestoration";
import {
  MasterBulkActionBar,
  MasterEmptyState,
  MasterErrorState,
  MasterListHeader,
  MasterListPageShell,
  MasterListPagination,
  MasterListToolbar,
  MasterNoResultsState,
  MasterRowCheckbox,
  MasterSearchInput,
  MasterSelectAllCheckbox,
  MasterSortHeader,
  MasterStatusBadge,
  MasterTableShell,
  MasterTableSkeleton,
  MasterTruncatedCell,
  MasterTypeBadge,
  masterTdClass,
  masterThClass,
  resultCountLabel,
} from "../components/masters/MasterListWorkbench";
import { useMasterListSelection, useMasterListWorkbench } from "../hooks/useMasterListWorkbench";
import {
  compareByKey,
  matchesNameSearch,
  normalizeSearchText,
  paginateRows,
} from "../lib/masterListQuery";
import { postMasterBulkMutation, summarizeMasterBulkResult } from "../lib/masterBulkApi";
import { AddItemTypeMenu } from "../components/masters/AddItemTypeMenu";
import {
  ITEM_TYPE_DEFINITIONS,
  itemTypeLabel,
  isItemTypeCode,
  type ItemTypeCode,
} from "../lib/itemTypes";

type Item = {
  id: number;
  itemName: string;
  itemType: ItemTypeCode;
  unit: string;
  unitId?: number | null;
  unitName?: string | null;
  minStockLevel: string;
  hsnCode?: string | null;
  gstRate?: string | null;
  // Business thresholds for planning zones (coverage %): stock/requirement*100.
  redThresholdPercent?: string | null;
  yellowThresholdPercent?: string | null;
  planningBufferPercent?: string | null;
  minimumStockQty?: string | null;
  reorderQty?: string | null;
  fgManualGreenLevelQty?: string | null;
  issueIncrement?: number | string | null;
  unitCode?: string | null;
  isActive: boolean;
};

type UnitRow = { id: number; unitName: string; unitCode?: string | null };

type StockSummaryRow = {
  itemId: number;
  usableQty: number;
};

const ITEM_DELETE_IN_USE = "Item is used in transactions and cannot be deleted.";
const LEGACY_ITEM_DELETE_MSG =
  "Item cannot be deleted because it is used in transactions or linked records.";

/** Avoid showing raw DB/Prisma FK errors if they ever slip through. */
function sanitizeItemDeleteErrorMessage(msg: string): string {
  if (msg === ITEM_DELETE_IN_USE || msg === LEGACY_ITEM_DELETE_MSG) return ITEM_DELETE_IN_USE;
  const m = msg.toLowerCase();
  if (
    m.includes("foreign key") ||
    m.includes("p2003") ||
    m.includes("constraint failed") ||
    m.includes("cannot delete or update a parent row")
  ) {
    return ITEM_DELETE_IN_USE;
  }
  return msg;
}

function isItemDeleteBlockedMessage(msg: string): boolean {
  return msg === ITEM_DELETE_IN_USE;
}

function normalizeHsnInput(raw: string): string {
  return raw.toUpperCase().slice(0, 32);
}

function normalizeHsnPayload(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return normalizeHsnInput(t);
}

function parseQtyStr(raw: string): number | null {
  return parseItemQtyStr(raw);
}

const STOCK_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Stock: All" },
  { value: "HEALTHY", label: "Healthy" },
  { value: "LOW", label: "Low" },
  { value: "CRITICAL", label: "Below Minimum" },
  { value: "OUT_OF_STOCK", label: "Out of stock" },
];

function itemUnitLabel(i: Item): string {
  return i.unitName?.trim() ? i.unitName : i.unit;
}

function itemStockStatus(i: Item, stockByItemId: Map<number, number>): ItemStockStatus {
  return itemStockStatusFromItemFields({
    currentQty: stockByItemId.get(i.id) ?? 0,
    minimumStockQty: i.minimumStockQty,
    minStockLevel: i.minStockLevel,
    reorderQty: i.reorderQty,
  });
}

export function ItemsPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  useListScrollRestoration();
  const [rows, setRows] = React.useState<Item[]>([]);
  const [units, setUnits] = React.useState<UnitRow[]>([]);
  const [stockByItemId, setStockByItemId] = React.useState<Map<number, number>>(() => new Map());
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const bulkInFlight = React.useRef(false);
  const [lifecycleItem, setLifecycleItem] = React.useState<Item | null>(null);
  const [dependencySummary, setDependencySummary] = React.useState<DependencySummary | null>(null);
  const [checkingDependencies, setCheckingDependencies] = React.useState(false);

  const wb = useMasterListWorkbench();
  const { query, setSearch, clearSearch, setStatusFilter, setFilter, clearFilters, toggleSort, setPage, setPageSize, queryContextKey } =
    wb;

  const [showForm, setShowForm] = React.useState(false);
  const [formBaseline, setFormBaseline] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [creatingType, setCreatingType] = React.useState<ItemTypeCode>("RM");
  /** When editing: false if item is referenced — type select locked. */
  const [typeChangeAllowed, setTypeChangeAllowed] = React.useState(true);  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [unitId, setUnitId] = React.useState<number | "">("");
  const [legacyUnitText, setLegacyUnitText] = React.useState<string>("");
  // RM Stock Control: Minimum Stock (mandatory) + optional Target Stock.
  // Low Stock Level / Buffer % are no longer Store-facing (derived internally when needed).
  const [minimumStock, setMinimumStock] = React.useState("");
  const [issueIncrement, setIssueIncrement] = React.useState("1");
  const [lowStockAlert, setLowStockAlert] = React.useState("");
  const [, setLowStockTouched] = React.useState(false);
  const [bufferPct, setBufferPct] = React.useState("");
  const [targetStock, setTargetStock] = React.useState("");
  const [targetStockOpen, setTargetStockOpen] = React.useState(false);
  const [criticalCoveragePct, setCriticalCoveragePct] = React.useState("50");
  const [warningCoveragePct, setWarningCoveragePct] = React.useState("80");
  const [hsnCode, setHsnCode] = React.useState("");
  const [gstRateStr, setGstRateStr] = React.useState("");
  const [taxOpen, setTaxOpen] = React.useState(false);
  const [planningOpen, setPlanningOpen] = React.useState(false);
  const [fgManualGreenLevel, setFgManualGreenLevel] = React.useState("");

  const itemFormSnap = React.useMemo(
    () =>
      snapshotItemForm({
        creatingType,
        name,
        unitId,
        legacyUnitText,
        minimumStock,
        lowStockAlert,
        bufferPct,
        targetStock,
        criticalCoveragePct,
        warningCoveragePct,
        hsnCode,
        gstRateStr,
        fgManualGreenLevel,
      }),
    [
      creatingType,
      name,
      unitId,
      legacyUnitText,
      minimumStock,
      lowStockAlert,
      bufferPct,
      targetStock,
      criticalCoveragePct,
      warningCoveragePct,
      hsnCode,
      gstRateStr,
      fgManualGreenLevel,
    ],
  );

  const formDirty = showForm && formBaseline != null && itemFormSnap !== formBaseline;
  useUnsavedChangesGuard({
    isDirty: formDirty,
    message: "Item form has unsaved changes. Leave and discard them?",
    enabled: showForm && !saving,
  });

  const itemFormRef = React.useRef<HTMLFormElement | null>(null);
  const itemFormScrollRef = React.useRef<HTMLDivElement | null>(null);

  const isRmStockForm = creatingType === "RM";
  const selectedUnitForForm =
    unitId === "" ? null : units.find((u) => u.id === Number(unitId)) ?? null;
  const showKgIssueIncrement = showIssueIncrementOnItemMaster({
    itemType: creatingType,
    unitCode: selectedUnitForForm?.unitCode,
    unitName: selectedUnitForForm?.unitName,
    unit: selectedUnitForForm?.unitName,
  });
  const showPlanningSensitivity = creatingType === "FG" || creatingType === "SFG";
  const showFgGreenLevel = creatingType === "FG";

  function captureItemBaseline(fields: Parameters<typeof snapshotItemForm>[0]) {
    setFormBaseline(snapshotItemForm(fields));
  }

  function quickFillDefaults() {
    // Only fill when empty; do not overwrite user-entered values.
    const minEmpty = minimumStock.trim() === "";
    const critEmpty = criticalCoveragePct.trim() === "";
    const warnEmpty = warningCoveragePct.trim() === "";
    const gstEmpty = gstRateStr.trim() === "";

    if (minEmpty) setMinimumStock(isRmStockForm ? "" : "0");
    if (critEmpty && !isRmStockForm) setCriticalCoveragePct("50");
    if (warnEmpty && !isRmStockForm) setWarningCoveragePct("80");
    if (gstEmpty) setGstRateStr("18");
  }

  function focusNextField(fromEl: HTMLElement) {
    const root = itemFormScrollRef.current || itemFormRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      ),
    ).filter((el) => {
      // Skip non-entry buttons (close/footer buttons) and hidden elements.
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    });
    const idx = focusables.indexOf(fromEl);
    if (idx < 0) return;
    const next = focusables[idx + 1] ?? null;
    if (!next) return;
    next.focus();
    if (next instanceof HTMLInputElement) next.select?.();
  }

  function load() {
    setLoading(true);
    setError(null);
    return Promise.all([
      apiFetch<Item[]>("/api/items?includeInactive=true"),
      apiFetch<UnitRow[]>("/api/units"),
      apiFetch<StockSummaryRow[]>("/api/stock/summary-buckets"),
    ])
      .then(([items, unitRows, stockRows]) => {
        setRows(items);
        setUnits(unitRows);
        const m = new Map<number, number>();
        for (const r of stockRows || []) {
          const id = Number(r.itemId);
          if (!Number.isFinite(id) || id <= 0) continue;
          const q = Number((r as { usableQty?: unknown }).usableQty ?? 0);
          m.set(id, Number.isFinite(q) ? q : 0);
        }
        setStockByItemId(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  React.useEffect(() => {
    void load();
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.debouncedSearch;
    const typeFilter = query.filters.type || "all";
    const unitFilter = query.filters.unitId || "";
    const stockFilter = query.filters.stockStatus || "all";
    // Item master has no separate code field — search itemName only.
    let list = rows.filter((i) => {
      if (!q.trim()) return true;
      return matchesNameSearch(i.itemName, q) || matchesNameSearch(i.hsnCode || "", q);
    });
    if (query.statusFilter === "active") list = list.filter((i) => i.isActive !== false);
    if (query.statusFilter === "inactive") list = list.filter((i) => i.isActive === false);
    if (typeFilter !== "all") list = list.filter((i) => i.itemType === typeFilter);
    if (unitFilter) {
      list = list.filter((i) => {
        if (i.unitId != null) return String(i.unitId) === unitFilter;
        const u = units.find((x) => String(x.id) === unitFilter);
        if (!u) return false;
        return normalizeSearchText(itemUnitLabel(i)) === normalizeSearchText(u.unitName);
      });
    }
    if (stockFilter !== "all") {
      list = list.filter((i) => itemStockStatus(i, stockByItemId) === stockFilter);
    }
    const key = query.sortKey;
    list = [...list].sort((a, b) =>
      compareByKey(
        a,
        b,
        (r) => {
          if (key === "type") return r.itemType;
          if (key === "unit") return itemUnitLabel(r);
          if (key === "status") return r.isActive === false ? 1 : 0;
          if (key === "gst") {
            const g = r.gstRate != null && String(r.gstRate).trim() !== "" ? Number(r.gstRate) : null;
            return g != null && Number.isFinite(g) ? g : -1;
          }
          if (key === "lowStock") {
            const n = Number(r.minStockLevel);
            return Number.isFinite(n) ? n : 0;
          }
          return r.itemName;
        },
        query.sortDir,
      ),
    );
    return list;
  }, [
    rows,
    units,
    stockByItemId,
    query.debouncedSearch,
    query.statusFilter,
    query.filters,
    query.sortKey,
    query.sortDir,
  ]);

  const { pageRows, totalPages, from, to } = paginateRows(filtered, query.page, query.pageSize);
  const pageIds = React.useMemo(() => pageRows.map((r) => r.id), [pageRows]);
  const bulkSel = useMasterListSelection(pageIds, queryContextKey);

  const searching =
    Boolean(normalizeSearchText(query.debouncedSearch)) ||
    query.statusFilter !== "all" ||
    Boolean(query.filters.type && query.filters.type !== "all") ||
    Boolean(query.filters.unitId) ||
    Boolean(query.filters.stockStatus && query.filters.stockStatus !== "all");

  function openAdd(type: ItemTypeCode) {
    setError(null);
    setEditingId(null);
    setTypeChangeAllowed(true);
    setCreatingType(type);
    setName("");
    setUnitId("");
    setLegacyUnitText("");
    setMinimumStock("");
    setLowStockAlert("");
    setLowStockTouched(false);
    setBufferPct("");
    setTargetStock("");
    setTargetStockOpen(false);
    setCriticalCoveragePct("50");
    setWarningCoveragePct("80");
    setHsnCode("");
    setGstRateStr("");
    setFgManualGreenLevel("");
    setIssueIncrement("1");
    // New item: keep tax fields visible by default.
    setTaxOpen(true);
    setPlanningOpen(false);
    captureItemBaseline({
      creatingType: type,
      name: "",
      unitId: "",
      legacyUnitText: "",
      minimumStock: "",
      lowStockAlert: "",
      bufferPct: "",
      targetStock: "",
      criticalCoveragePct: "50",
      warningCoveragePct: "80",
      hsnCode: "",
      gstRateStr: "",
      fgManualGreenLevel: "",
    });
    setShowForm(true);
  }

  function openEdit(i: Item) {
    setError(null);
    setEditingId(i.id);
    const nextType: ItemTypeCode = isItemTypeCode(i.itemType) ? i.itemType : "RM";
    setCreatingType(nextType);
    setTypeChangeAllowed(false);
    setName(i.itemName);
    const nextUnitId = i.unitId ?? "";
    setUnitId(nextUnitId);
    const nextLegacy = i.unit ?? "";
    setLegacyUnitText(nextLegacy);
    const nextLow =
      i.minStockLevel != null && String(i.minStockLevel).trim() !== "" && Number(i.minStockLevel) !== 0
        ? String(i.minStockLevel)
        : "";
    setLowStockAlert(nextLow);
    setLowStockTouched(false);
    const isRm = i.itemType === "RM";
    let nextBuffer = "";
    if (i.planningBufferPercent != null && String(i.planningBufferPercent).trim() !== "") {
      nextBuffer = String(i.planningBufferPercent);
    } else {
      nextBuffer = isRm ? "0" : "";
    }
    setBufferPct(nextBuffer);
    const nextHsn = i.hsnCode?.trim() ?? "";
    setHsnCode(nextHsn);
    const gr = i.gstRate;
    const nextGst = gr != null && String(gr).trim() !== "" ? String(gr) : "";
    setGstRateStr(nextGst);
    const nextMin =
      i.minimumStockQty != null && String(i.minimumStockQty).trim() !== "" ? String(i.minimumStockQty) : "";
    setMinimumStock(nextMin);
    const nextTarget =
      i.reorderQty != null && String(i.reorderQty).trim() !== "" ? String(i.reorderQty) : "";
    setTargetStock(nextTarget);
    setTargetStockOpen(Boolean(i.reorderQty != null && String(i.reorderQty).trim() !== "" && Number(i.reorderQty) > 0));
    const nextCrit =
      i.redThresholdPercent != null && String(i.redThresholdPercent).trim() !== ""
        ? String(i.redThresholdPercent)
        : "50";
    setCriticalCoveragePct(nextCrit);
    const nextWarn =
      i.yellowThresholdPercent != null && String(i.yellowThresholdPercent).trim() !== ""
        ? String(i.yellowThresholdPercent)
        : "80";
    setWarningCoveragePct(nextWarn);
    const nextFg =
      i.fgManualGreenLevelQty != null && String(i.fgManualGreenLevelQty).trim() !== ""
        ? String(i.fgManualGreenLevelQty)
        : "";
    setFgManualGreenLevel(nextFg);
    const nextInc =
      i.issueIncrement != null && String(i.issueIncrement).trim() !== "" && Number(i.issueIncrement) > 0
        ? String(i.issueIncrement)
        : "1";
    setIssueIncrement(nextInc);
    // Editing: collapse only when tax info already exists; otherwise keep it open so it’s discoverable.
    const hasTaxInfo = Boolean((i.hsnCode ?? "").trim()) && Boolean(String(i.gstRate ?? "").trim());
    setTaxOpen(!hasTaxInfo);
    setPlanningOpen(false);
    captureItemBaseline({
      creatingType: nextType,
      name: i.itemName,
      unitId: nextUnitId,
      legacyUnitText: nextLegacy,
      minimumStock: nextMin,
      lowStockAlert: nextLow,
      bufferPct: nextBuffer,
      targetStock: nextTarget,
      criticalCoveragePct: nextCrit,
      warningCoveragePct: nextWarn,
      hsnCode: nextHsn,
      gstRateStr: nextGst,
      fgManualGreenLevel: nextFg,
    });
    setShowForm(true);
    void apiFetch<DependencySummary>(`/api/items/${i.id}/dependencies`)
      .then((summary) => {
        setTypeChangeAllowed(Boolean(summary?.safeToDelete));
      })
      .catch(() => {
        // Fail closed: do not offer type change if we cannot confirm safety.
        setTypeChangeAllowed(false);
      });
  }

  function closeForm() {
    setError(null);
    setShowForm(false);
    setEditingId(null);
    setFormBaseline(null);
  }

  function requestCloseForm() {
    if (!confirmLeaveIfDirty(formDirty, "Item form has unsaved changes. Leave and discard them?")) return;
    closeForm();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (saving) return;
    const itemName = normalizeMasterNameDisplay(name);
    if (!itemName) {
      setError("Item name is required");
      return;
    }
    const lowTrim = lowStockAlert.trim();
    const lowNum = lowTrim === "" ? 0 : Number(lowTrim);
    if (!isRmStockForm && (Number.isNaN(lowNum) || lowNum < 0)) {
      setError("Low Stock Level must be zero or a positive number");
      return;
    }

    const hsnPayload = normalizeHsnPayload(hsnCode);

    let gstRatePayload: number | null | undefined;
    const grTrim = gstRateStr.trim();
    if (grTrim === "") {
      gstRatePayload = editingId != null ? null : undefined;
    } else {
      const g = Number(grTrim);
      if (Number.isNaN(g) || g < 0) {
        setError("GST rate % must be a non-negative number");
        return;
      }
      if (g > 100) {
        setError("GST rate % cannot exceed 100");
        return;
      }
      gstRatePayload = g;
    }

    function parseOptionalQty(raw: string): number | null | undefined {
      const t = raw.trim();
      if (t === "") return editingId != null ? null : undefined;
      const n = Number(t);
      if (Number.isNaN(n) || n < 0) throw new Error("Quantity must be a non-negative number");
      return n;
    }
    function parseCoveragePercent(raw: string, label: string): number | null | undefined {
      const t = raw.trim();
      if (t === "") return editingId != null ? null : undefined;
      const n = Number(t);
      if (Number.isNaN(n) || n < 0) throw new Error(`${label} must be a non-negative number`);
      if (n > 100) throw new Error(`${label} cannot exceed 100`);
      return n;
    }

    let minimumStockQtyPayload: number | null | undefined;
    let reorderQtyPayload: number | null | undefined;
    let planningBufferPayload: number | null | undefined;
    let criticalPctPayload: number | null | undefined;
    let warningPctPayload: number | null | undefined;
    let fgManualGreenLevelPayload: number | null | undefined;
    let minStockLevelPayload = lowNum;
    try {
      minimumStockQtyPayload = parseOptionalQty(minimumStock);
      if (isRmStockForm) {
        if (minimumStockQtyPayload == null || !(minimumStockQtyPayload > 0)) {
          throw new Error("Minimum Stock is mandatory for RM items");
        }
        reorderQtyPayload = parseOptionalQty(targetStock);
        if (
          reorderQtyPayload != null &&
          reorderQtyPayload > 0 &&
          reorderQtyPayload < minimumStockQtyPayload
        ) {
          throw new Error("Target Stock must be greater than or equal to Minimum Stock");
        }
        // Internally align legacy low-stock column to minimum (UI no longer exposes Buffer / Low Stock).
        minStockLevelPayload = minimumStockQtyPayload;
        planningBufferPayload = editingId != null ? null : undefined;
      }
      if (showPlanningSensitivity) {
        criticalPctPayload = parseCoveragePercent(criticalCoveragePct, "Critical coverage %");
        warningPctPayload = parseCoveragePercent(warningCoveragePct, "Warning coverage %");
      }
      if (showFgGreenLevel) {
        fgManualGreenLevelPayload = parseOptionalQty(fgManualGreenLevel);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid stock control fields");
      return;
    }

    let issueIncrementPayload: number | null | undefined;
    if (showKgIssueIncrement) {
      const inc = Number(String(issueIncrement).trim());
      if (!Number.isFinite(inc) || !(inc > 0)) {
        setError("Issue Increment (Kg) must be greater than 0.");
        return;
      }
      issueIncrementPayload = inc;
    } else {
      issueIncrementPayload = null;
    }

    const itemKey = normalizeMasterNameKey(itemName);
    const dup = rows.some((r) => r.id !== editingId && normalizeMasterNameKey(r.itemName) === itemKey);
    if (dup) {
      setError("Duplicate name not allowed");
      return;
    }

    const selectedUnit = unitId === "" ? null : units.find((u) => u.id === Number(unitId)) ?? null;
    const unitIdPayload = selectedUnit ? selectedUnit.id : null;

    setSaving(true);
    try {
      if (editingId != null) {
        const unitPatch = unitIdPayload != null ? { unitId: unitIdPayload } : {};
        await apiFetch(`/api/items/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            itemName,
            itemType: creatingType,
            // Legacy low-stock column: for RM, aligned to Minimum Stock (no separate Low Stock UI).
            minStockLevel: minStockLevelPayload,
            hsnCode: hsnPayload,
            gstRate: gstRatePayload,
            // Minimum stock (RED) + Target stock (optional)
            ...(minimumStockQtyPayload !== undefined ? { minimumStockQty: minimumStockQtyPayload } : {}),
            ...(reorderQtyPayload !== undefined ? { reorderQty: reorderQtyPayload } : {}),
            ...(planningBufferPayload !== undefined
              ? { planningBufferPercent: planningBufferPayload }
              : {}),
            ...(criticalPctPayload !== undefined ? { redThresholdPercent: criticalPctPayload } : {}),
            ...(warningPctPayload !== undefined ? { yellowThresholdPercent: warningPctPayload } : {}),
            ...(fgManualGreenLevelPayload !== undefined
              ? { fgManualGreenLevelQty: fgManualGreenLevelPayload }
              : {}),
            ...(issueIncrementPayload !== undefined ? { issueIncrement: issueIncrementPayload } : {}),
            ...unitPatch,
          }),
        });
      } else {
        if (unitIdPayload == null) {
          setError("Unit is required");
          return;
        }
        await apiFetch("/api/items", {
          method: "POST",
          body: JSON.stringify({
            itemName,
            itemType: creatingType,
            unitId: unitIdPayload,
            // Legacy low-stock column: for RM, aligned to Minimum Stock (no separate Low Stock UI).
            minStockLevel: minStockLevelPayload,
            // Tax info is required by backend; keep in collapsible UI but always send.
            ...(hsnPayload ? { hsnCode: hsnPayload } : {}),
            ...(gstRatePayload !== undefined ? { gstRate: gstRatePayload } : {}),
            ...(minimumStockQtyPayload !== undefined ? { minimumStockQty: minimumStockQtyPayload } : {}),
            ...(reorderQtyPayload !== undefined ? { reorderQty: reorderQtyPayload } : {}),
            ...(planningBufferPayload !== undefined
              ? { planningBufferPercent: planningBufferPayload }
              : {}),
            ...(criticalPctPayload !== undefined ? { redThresholdPercent: criticalPctPayload } : {}),
            ...(warningPctPayload !== undefined ? { yellowThresholdPercent: warningPctPayload } : {}),
            ...(showFgGreenLevel && fgManualGreenLevelPayload !== undefined
              ? { fgManualGreenLevelQty: fgManualGreenLevelPayload }
              : {}),
            ...(issueIncrementPayload !== undefined ? { issueIncrement: issueIncrementPayload } : {}),
          }),
        });
      }
      closeForm();
      await load();
      toast.showSuccess("Saved successfully");
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function inspectLifecycle(item: Item) {
    setLifecycleItem(item);
    setDependencySummary(null);
    setCheckingDependencies(true);
    try {
      setDependencySummary(await apiFetch<DependencySummary>(`/api/items/${item.id}/dependencies`));
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Dependency check failed");
      setLifecycleItem(null);
    } finally {
      setCheckingDependencies(false);
    }
  }

  async function deleteLifecycleItem() {
    if (!lifecycleItem) return;
    try {
      await apiFetch(`/api/items/${lifecycleItem.id}`, { method: "DELETE" });
      setLifecycleItem(null);
      await load();
      toast.showSuccess("Item deleted");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed";
      const msg = sanitizeItemDeleteErrorMessage(raw);
      if (isItemDeleteBlockedMessage(msg)) {
        toast.showInfo(msg);
      } else {
        toast.showError(msg);
      }
    }
  }

  async function deactivateLifecycleItem() {
    if (!lifecycleItem) return;
    try {
      await apiFetch(`/api/items/${lifecycleItem.id}/deactivate`, { method: "POST" });
      setLifecycleItem(null);
      await load();
      toast.showSuccess("Item marked inactive");
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Failed to mark inactive");
    }
  }

  async function runBulk(action: "activate" | "deactivate" | "delete") {
    if (bulkInFlight.current) return;
    const ids = bulkSel.getSelectedIdsArray();
    if (!ids.length) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    try {
      const result = await postMasterBulkMutation("items", action, ids);
      const verb = action === "activate" ? "activated" : action === "deactivate" ? "deactivated" : "deleted";
      const summary = summarizeMasterBulkResult(result, verb);
      if (summary.tone === "success") toast.showSuccess(summary.message);
      else if (summary.tone === "info") toast.showInfo(summary.message);
      else toast.showError(summary.message);
      bulkSel.clear();
      await load();
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Bulk action failed.");
    } finally {
      bulkInFlight.current = false;
      setBulkBusy(false);
      setBulkDeleteOpen(false);
    }
  }

  const addActions = isAdmin ? <AddItemTypeMenu onSelect={(type) => openAdd(type)} /> : null;

  return (
    <MasterListPageShell>
      <MasterListHeader
        title="Items"
        description="Raw materials, finished goods, semi-finished and consumable items."
        actions={addActions}
      />

      {error && !showForm ? <MasterErrorState message={error} onRetry={() => void load()} /> : null}

      <MasterListToolbar
        search={
          <MasterSearchInput
            value={query.search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search items by name or code…"
            aria-label="Search items by name or code"
          />
        }
        filters={
          <>
            <NativeSelect
              className="h-9 w-[8.5rem] text-sm"
              value={query.filters.type || "all"}
              onChange={(e) => setFilter("type", e.target.value)}
              aria-label="Filter by type"
            >
              <option value="all">Type: All</option>
              {ITEM_TYPE_DEFINITIONS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.shortLabel}
                </option>
              ))}
            </NativeSelect>            <NativeSelect
              className="h-9 min-w-[8rem] max-w-[11rem] text-sm"
              value={query.filters.unitId || ""}
              onChange={(e) => setFilter("unitId", e.target.value)}
              aria-label="Filter by unit"
            >
              <option value="">Unit: All</option>
              {units.map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.unitName}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="h-9 min-w-[9rem] max-w-[12rem] text-sm"
              value={query.filters.stockStatus || "all"}
              onChange={(e) => setFilter("stockStatus", e.target.value)}
              aria-label="Filter by stock status"
            >
              {STOCK_STATUS_FILTERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              className="h-9 w-[8.5rem] text-sm"
              value={query.statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive")}
              aria-label="Filter by status"
            >
              <option value="all">Status: All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
          </>
        }
        resultLabel={resultCountLabel({ filtered: filtered.length, total: rows.length, searching })}
        showClearFilters={searching}
        onClearFilters={clearFilters}
        bulkBar={
          isAdmin && bulkSel.selectedCount > 0 ? (
            <MasterBulkActionBar
              selectedCount={bulkSel.selectedCount}
              entityLabel={bulkSel.selectedCount === 1 ? "item" : "items"}
              busy={bulkBusy}
              onClear={bulkSel.clear}
              onActivate={() => void runBulk("activate")}
              onDeactivate={() => void runBulk("deactivate")}
              onDelete={() => setBulkDeleteOpen(true)}
            />
          ) : null
        }
      />

      {loading ? (
        <MasterTableShell>
          <thead>
            <tr>
              {Array.from({ length: 10 }).map((_, i) => (
                <th key={i} className={masterThClass}>
                  &nbsp;
                </th>
              ))}
            </tr>
          </thead>
          <MasterTableSkeleton cols={10} />
        </MasterTableShell>
      ) : rows.length === 0 ? (
        <MasterEmptyState
          title="No items yet"
          description="Add raw materials, finished goods, or semi-finished items to the master list."
        />
      ) : filtered.length === 0 ? (
        <MasterNoResultsState query={query.debouncedSearch || "filters"} onClear={clearFilters} />
      ) : (
        <>
          <MasterTableShell>
            <thead>
              <tr>
                {isAdmin ? (
                  <MasterSelectAllCheckbox
                    checked={bulkSel.allSelected}
                    indeterminate={bulkSel.someSelected}
                    inputRef={bulkSel.selectAllRef}
                    onChange={bulkSel.toggleSelectAll}
                    disabled={pageRows.length === 0}
                  />
                ) : null}
                <MasterSortHeader label="Item name" sortKey="name" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <MasterSortHeader label="Type" sortKey="type" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <MasterSortHeader label="Unit" sortKey="unit" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <th className={masterThClass}>Stock status</th>
                <th className={masterThClass}>HSN</th>
                <MasterSortHeader label="GST %" sortKey="gst" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                <MasterSortHeader
                  label="Low Stock Level"
                  sortKey="lowStock"
                  activeKey={query.sortKey}
                  dir={query.sortDir}
                  onToggle={toggleSort}
                />
                <MasterSortHeader label="Status" sortKey="status" activeKey={query.sortKey} dir={query.sortDir} onToggle={toggleSort} />
                {isAdmin ? <th className={`${masterThClass} text-right`}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((i) => {
                const currentQty = stockByItemId.get(i.id) ?? 0;
                return (
                  <tr key={i.id} className={i.isActive === false ? "opacity-70" : undefined} style={{ height: 50 }}>
                    {isAdmin ? (
                      <MasterRowCheckbox
                        id={i.id}
                        checked={bulkSel.selectedIds.has(i.id)}
                        onChange={(checked) => bulkSel.toggleOne(i.id, checked)}
                        label={i.itemName}
                      />
                    ) : null}
                    <MasterTruncatedCell text={i.itemName} />
                    <td className={masterTdClass}>
                      <MasterTypeBadge type={i.itemType} />
                    </td>
                    <td className={masterTdClass}>{itemUnitLabel(i)}</td>
                    <td className={masterTdClass}>
                      <ItemStockStatusBadge
                        currentQty={currentQty}
                        minimumStockQty={i.minimumStockQty}
                        minStockLevel={i.minStockLevel}
                        reorderQty={i.reorderQty}
                      />
                    </td>
                    <td className={`${masterTdClass} text-slate-600`}>{i.hsnCode?.trim() ? i.hsnCode : "—"}</td>
                    <td className={`${masterTdClass} text-slate-600`}>
                      {i.gstRate != null && String(i.gstRate).trim() !== "" ? i.gstRate : "—"}
                    </td>
                    <td className={masterTdClass}>{i.minStockLevel}</td>
                    <td className={masterTdClass}>
                      <MasterStatusBadge active={i.isActive !== false} />
                    </td>
                    {isAdmin ? (
                      <td className={masterTdClass}>
                        <div className="erp-table-actions" onClick={(e) => e.stopPropagation()}>
                          <Button type="button" size="icon" variant="outline" onClick={() => openEdit(i)} aria-label="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="text-slate-600 hover:text-red-700"
                            onClick={() => void inspectLifecycle(i)}
                            aria-label="Review dependencies"
                            title="Review delete or inactive options"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </MasterTableShell>
          <MasterListPagination
            page={query.page}
            pageSize={query.pageSize}
            totalPages={totalPages}
            from={from}
            to={to}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <BulkDeleteConfirmModal
        open={bulkDeleteOpen}
        count={bulkSel.selectedCount}
        entityLabel="item"
        loading={bulkBusy}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={() => void runBulk("delete")}
      />
      <DependencyLifecycleModal
        open={lifecycleItem != null}
        summary={dependencySummary}
        loading={checkingDependencies}
        onClose={() => setLifecycleItem(null)}
        onDelete={deleteLifecycleItem}
        onDeactivate={deactivateLifecycleItem}
      />

      {showForm ? (
        <ErpModal onClose={requestCloseForm} closeOnBackdropClick draggable>
          <ErpModalFrame
            size="xl"
            onClose={requestCloseForm}
            closeButtonTestId="item-master-modal-close"
            title={
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900">
                  {editingId != null ? "Edit Item" : `Add Item — ${itemTypeLabel(creatingType)}`}
                </div>
                <div className="text-xs text-slate-500">{itemTypeLabel(creatingType)}</div>
              </div>
            }
            headerActions={
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={quickFillDefaults}>
                Quick Fill Defaults
              </Button>
            }
          >
              <form
                ref={itemFormRef}
                onSubmit={onSubmit}
                className="flex min-h-0 flex-1 flex-col"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    itemFormRef.current?.requestSubmit();
                    return;
                  }
                  // Enter moves to next field for faster data entry (avoid accidental submits).
                  if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                    const t = e.target as HTMLElement | null;
                    if (!t) return;
                    const tag = t.tagName.toLowerCase();
                    if (tag === "textarea") return;
                    if (tag === "input" || tag === "select") {
                      e.preventDefault();
                      focusNextField(t);
                    }
                  }
                }}
              >
                <ErpModalFrameBody ref={itemFormScrollRef}>
                    <div className="grid gap-3 md:grid-cols-2">
                      {/* LEFT: Basic Details + Tax Info */}
                      <div className="space-y-3">
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Details</div>
                          <div className="mt-2 grid gap-2.5">
                            <div className="erp-form-field">
                              <span className="erp-form-label">Item name</span>
                              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" />
                            </div>
                            <div className="erp-form-row-2">
                              <div className="erp-form-field">
                                <span className="erp-form-label">Type</span>
                                {editingId != null && !typeChangeAllowed ? (
                                  <div className="pt-1">
                                    <MasterTypeBadge type={creatingType} />
                                    <p className="mt-1 text-xs text-slate-500">
                                      Type is locked because this item is used in transactions.
                                    </p>
                                  </div>
                                ) : editingId != null ? (
                                  <select
                                    className="erp-select"
                                    value={creatingType}
                                    aria-label="Item type"
                                    data-testid="item-form-type-select"
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (isItemTypeCode(v)) setCreatingType(v);
                                    }}
                                  >
                                    {ITEM_TYPE_DEFINITIONS.map((t) => (
                                      <option key={t.code} value={t.code}>
                                        {t.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <div className="pt-1">
                                    <MasterTypeBadge type={creatingType} />
                                  </div>
                                )}
                              </div>
                              <div className="erp-form-field">
                                <span className="erp-form-label">Unit</span>                                <select
                                  className="erp-select"
                                  value={unitId}
                                  onChange={(e) => setUnitId(e.target.value === "" ? "" : Number(e.target.value))}
                                >
                                  <option value="">Select unit</option>
                                  {units.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.unitName}
                                    </option>
                                  ))}
                                </select>
                                {unitId === "" && legacyUnitText.trim() ? (
                                  <div className="mt-1 text-[12px] text-slate-600">
                                    Previous: <span className="font-medium">{legacyUnitText}</span>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>

                        <details
                          className="rounded-md border border-slate-200 bg-white px-3 py-2"
                          open={taxOpen}
                          onToggle={(e) => setTaxOpen((e.target as HTMLDetailsElement).open)}
                        >
                          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Tax Info (HSN / GST)
                          </summary>
                          <div className="mt-2.5 grid gap-2.5">
                            <div className="erp-form-field">
                              <span className="erp-form-label">HSN code</span>
                              <Input
                                value={hsnCode}
                                onChange={(e) => setHsnCode(normalizeHsnInput(e.target.value))}
                                placeholder="HSN"
                                maxLength={32}
                              />
                            </div>
                            <div className="erp-form-field">
                              <span className="erp-form-label">GST rate %</span>
                              <div className="flex flex-wrap items-center gap-2">
                                <DecimalInput
                                  className="max-w-[8rem]"
                                  value={gstRateStr}
                                  onValueChange={setGstRateStr}
                                  normalizeOnBlur={false}
                                  placeholder=""
                                />
                                <select
                                  className="erp-select max-w-[10rem] text-sm"
                                  aria-label="Common GST rates"
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "") return;
                                    setGstRateStr(v);
                                    e.target.value = "";
                                  }}
                                >
                                  <option value="">Common…</option>
                                  <option value="0">0%</option>
                                  <option value="5">5%</option>
                                  <option value="12">12%</option>
                                  <option value="18">18%</option>
                                  <option value="28">28%</option>
                                </select>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">Optional</p>
                            </div>
                          </div>
                        </details>
                      </div>

                      {/* RIGHT: Stock Control + Planning Sensitivity */}
                      <div className="space-y-3">
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {isRmStockForm ? "RM Stock Control" : "Stock Control"}
                          </div>
                          <div className="mt-2 grid gap-2.5">
                            {isRmStockForm ? (
                              <>
                                <div className="erp-form-field max-w-xs">
                                  <span className="erp-form-label">Minimum Stock</span>
                                  <DecimalInput
                                    value={minimumStock}
                                    onValueChange={setMinimumStock}
                                    normalizeOnBlur={false}
                                    placeholder="Required"
                                    required
                                  />
                                  <p className="mt-1 text-xs text-slate-500">
                                    Mandatory. Raise Replenishment Request when Current Stock falls below this level.
                                  </p>
                                </div>
                                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/80 px-2.5 py-2">
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                                    onClick={() => setTargetStockOpen((o) => !o)}
                                  >
                                    {targetStockOpen ? "Hide advanced" : "Advanced: Target Stock (optional)"}
                                  </button>
                                  {targetStockOpen ? (
                                    <div className="erp-form-field mt-2 max-w-xs">
                                      <span className="erp-form-label">Target Stock</span>
                                      <DecimalInput
                                        value={targetStock}
                                        onValueChange={setTargetStock}
                                        normalizeOnBlur={false}
                                        placeholder="Optional"
                                      />
                                      <p className="mt-1 text-xs text-slate-500">
                                        When set, suggested purchase qty = Target − Current. Status “Low” applies
                                        between Minimum and Target.
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                                {showKgIssueIncrement ? (
                                  <div className="erp-form-field max-w-xs" data-testid="item-issue-increment-field">
                                    <span className="erp-form-label">Issue Increment (Kg)</span>
                                    <DecimalInput
                                      value={issueIncrement}
                                      onValueChange={setIssueIncrement}
                                      normalizeOnBlur={false}
                                      placeholder="1"
                                      required
                                    />
                                    <p className="mt-1 text-xs text-slate-500">
                                      Store issues upward to this step (e.g. 1 Kg). Must be greater than 0.
                                    </p>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <div className="grid gap-2.5 sm:grid-cols-2">
                                <div className="erp-form-field">
                                  <span className="erp-form-label">Minimum stock</span>
                                  <DecimalInput
                                    value={minimumStock}
                                    onValueChange={setMinimumStock}
                                    normalizeOnBlur={false}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="erp-form-field">
                                  <span className="erp-form-label">Low Stock Level</span>
                                  <DecimalInput
                                    value={lowStockAlert}
                                    onValueChange={(next) => {
                                      setLowStockAlert(next);
                                      setLowStockTouched(true);
                                    }}
                                    normalizeOnBlur={false}
                                    placeholder="0"
                                  />
                                  <p className="mt-1 text-xs text-slate-500">Optional warning level for on-hand visibility</p>
                                </div>
                                {showFgGreenLevel ? (
                                  <div className="erp-form-field sm:col-span-2 max-w-xs">
                                    <span className="erp-form-label">Manual Green Level qty</span>
                                    <DecimalInput
                                      value={fgManualGreenLevel}
                                      onValueChange={setFgManualGreenLevel}
                                      normalizeOnBlur={false}
                                      placeholder="From Excel at go-live"
                                    />
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </div>

                        {showPlanningSensitivity ? (
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Planning Sensitivity</div>
                            <button
                              type="button"
                              className="text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
                              onClick={() => setPlanningOpen((o) => !o)}
                            >
                              {planningOpen ? "Hide" : "Show"}
                            </button>
                          </div>
                          {planningOpen ? (
                            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                              <div className="erp-form-field">
                                <span className="erp-form-label">Critical below (%)</span>
                                <DecimalInput
                                  value={criticalCoveragePct}
                                  onValueChange={setCriticalCoveragePct}
                                  normalizeOnBlur={false}
                                  placeholder="50"
                                />
                              </div>
                              <div className="erp-form-field">
                                <span className="erp-form-label">Warning below (%)</span>
                                <DecimalInput
                                  value={warningCoveragePct}
                                  onValueChange={setWarningCoveragePct}
                                  normalizeOnBlur={false}
                                  placeholder="80"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1 text-xs text-slate-500">Optional settings</div>
                          )}
                        </div>
                        ) : null}
                      </div>
                    </div>

                    {(() => {
                      const currentQty = editingId != null ? stockByItemId.get(editingId) ?? 0 : 0;
                      const minVal = parseQtyStr(minimumStock);
                      const lowVal = parseQtyStr(lowStockAlert);
                      return (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-sm">
                              <div className="text-xs font-medium text-slate-600">Live Preview</div>
                              <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-slate-900">
                                <span>
                                  Minimum: <span className="tabular-nums font-semibold">{minVal ?? 0}</span>
                                </span>
                                {isRmStockForm ? (
                                  <span>
                                    Target:{" "}
                                    <span className="tabular-nums font-semibold">
                                      {parseQtyStr(targetStock) ?? "—"}
                                    </span>
                                  </span>
                                ) : (
                                  <span>
                                    Low: <span className="tabular-nums font-semibold">{lowVal ?? 0}</span>
                                  </span>
                                )}
                                <span>
                                  Current: <span className="tabular-nums font-semibold">{currentQty}</span>
                                </span>
                              </div>
                            </div>
                            <ItemStockStatusBadge
                              currentQty={currentQty}
                              minimumStockQty={minimumStock}
                              minStockLevel={isRmStockForm ? minimumStock : lowStockAlert}
                              reorderQty={isRmStockForm ? targetStock : undefined}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {error ? (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
                    ) : null}
                </ErpModalFrameBody>

                <ErpModalFrameFooter>
                    <Button type="button" variant="outline" onClick={requestCloseForm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : editingId != null ? "Save" : "Create"}
                    </Button>
                </ErpModalFrameFooter>
              </form>
          </ErpModalFrame>
        </ErpModal>
      ) : null}
    </MasterListPageShell>
  );
}
