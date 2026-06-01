import * as React from "react";
import { Card, CardContent } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuth } from "../hooks/useAuth";
import { PageActions } from "../components/PageHeader";
import { useToast } from "../contexts/ToastContext";
import { Pencil, Trash2, X } from "lucide-react";
import { normalizeMasterNameDisplay, normalizeMasterNameKey } from "../lib/masterNameNormalize";
import { useBulkSelection } from "../hooks/useBulkSelection";
import { BulkSelectionToolbar } from "../components/masters/BulkSelectionToolbar";
import { BulkDeleteConfirmModal } from "../components/masters/BulkDeleteConfirmModal";
import { BULK_DELETE_IN_USE_TOAST, bulkDeleteByIds } from "../lib/masterBulkDelete";
import { ItemStockStatusBadge } from "../components/erp/ItemStockStatusBadge";
import { parseItemQtyStr } from "../lib/itemStockStatus";
import {
  computeDerivedLowStockLevel,
  DEFAULT_RM_BUFFER_PERCENT_NEW,
} from "../lib/inventoryHealth";
import { ErpModal } from "../components/erp/ErpModal";

type Item = {
  id: number;
  itemName: string;
  itemType: "RM" | "FG" | "SFG" | "CONSUMABLE";
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

export function ItemsPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [rows, setRows] = React.useState<Item[]>([]);
  const [units, setUnits] = React.useState<UnitRow[]>([]);
  const [stockByItemId, setStockByItemId] = React.useState<Map<number, number>>(() => new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [bulkDeleting, setBulkDeleting] = React.useState(false);

  const rowIds = React.useMemo(() => rows.map((r) => r.id), [rows]);
  const bulkSel = useBulkSelection(rowIds);

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [creatingType, setCreatingType] = React.useState<"RM" | "FG" | "SFG">("RM");
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [unitId, setUnitId] = React.useState<number | "">("");
  const [legacyUnitText, setLegacyUnitText] = React.useState<string>("");
  // Absolute quantities only (non-technical):
  // - Minimum stock -> RED
  // - Low stock level -> YELLOW
  // - Target stock -> optional (planning hint)
  const [minimumStock, setMinimumStock] = React.useState("");
  const [lowStockAlert, setLowStockAlert] = React.useState("");
  const [lowStockTouched, setLowStockTouched] = React.useState(false);
  const [bufferPct, setBufferPct] = React.useState("25");
  const [targetStock, setTargetStock] = React.useState("");
  const [criticalCoveragePct, setCriticalCoveragePct] = React.useState("50");
  const [warningCoveragePct, setWarningCoveragePct] = React.useState("80");
  const [hsnCode, setHsnCode] = React.useState("");
  const [gstRateStr, setGstRateStr] = React.useState("");
  const [taxOpen, setTaxOpen] = React.useState(false);
  const [planningOpen, setPlanningOpen] = React.useState(false);

  const itemFormRef = React.useRef<HTMLFormElement | null>(null);
  const itemFormScrollRef = React.useRef<HTMLDivElement | null>(null);

  const isRmStockForm = creatingType === "RM";

  function bufferPercentForAutoCalc(): number {
    const parsed = parseQtyStr(bufferPct);
    if (parsed != null) return parsed;
    return editingId != null ? 0 : DEFAULT_RM_BUFFER_PERCENT_NEW;
  }

  React.useEffect(() => {
    // Auto-fill Low Stock from Minimum using buffer%, but only until user edits Low Stock manually.
    if (!isRmStockForm || lowStockTouched) return;
    const minVal = parseQtyStr(minimumStock);
    if (minVal == null || minVal <= 0) return;
    const suggested = computeDerivedLowStockLevel(minVal, bufferPercentForAutoCalc());
    setLowStockAlert(String(suggested));
  }, [minimumStock, bufferPct, lowStockTouched, isRmStockForm, editingId]);

  function quickFillDefaults() {
    // Only fill when empty; do not overwrite user-entered values.
    const minEmpty = minimumStock.trim() === "";
    const bufEmpty = bufferPct.trim() === "";
    const lowEmpty = lowStockAlert.trim() === "";
    const critEmpty = criticalCoveragePct.trim() === "";
    const warnEmpty = warningCoveragePct.trim() === "";
    const gstEmpty = gstRateStr.trim() === "";

    const nextMin = minEmpty ? "0" : minimumStock;
    const nextBuf =
      bufEmpty && isRmStockForm
        ? String(editingId != null ? 0 : DEFAULT_RM_BUFFER_PERCENT_NEW)
        : bufferPct;

    if (minEmpty) setMinimumStock("0");
    if (bufEmpty && isRmStockForm) {
      setBufferPct(editingId != null ? "0" : String(DEFAULT_RM_BUFFER_PERCENT_NEW));
    }
    if (critEmpty) setCriticalCoveragePct("50");
    if (warnEmpty) setWarningCoveragePct("80");
    if (gstEmpty) setGstRateStr("18");

    if (lowEmpty) {
      const minVal = parseQtyStr(nextMin) ?? 0;
      const bufVal = parseQtyStr(nextBuf) ?? (editingId != null ? 0 : DEFAULT_RM_BUFFER_PERCENT_NEW);
      setLowStockAlert(String(computeDerivedLowStockLevel(minVal, bufVal)));
      // Keep as auto-filled (not user-touched).
      setLowStockTouched(false);
    }
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
    return Promise.all([
      apiFetch<Item[]>("/api/items"),
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
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }

  React.useEffect(() => {
    load();
  }, []);

  function openAdd(type: "RM" | "FG" | "SFG") {
    setError(null);
    setEditingId(null);
    setCreatingType(type);
    setName("");
    setUnitId("");
    setLegacyUnitText("");
    setMinimumStock("");
    setLowStockAlert("");
    setLowStockTouched(false);
    setBufferPct(type === "RM" ? String(DEFAULT_RM_BUFFER_PERCENT_NEW) : "");
    setTargetStock("");
    setCriticalCoveragePct("50");
    setWarningCoveragePct("80");
    setHsnCode("");
    setGstRateStr("");
    // New item: keep tax fields visible by default.
    setTaxOpen(true);
    setPlanningOpen(false);
    setShowForm(true);
  }

  function openEdit(i: Item) {
    setError(null);
    setEditingId(i.id);
    setCreatingType(i.itemType === "CONSUMABLE" ? "RM" : i.itemType);
    setName(i.itemName);
    setUnitId(i.unitId ?? "");
    setLegacyUnitText(i.unit ?? "");
    setLowStockAlert(
      i.minStockLevel != null && String(i.minStockLevel).trim() !== "" && Number(i.minStockLevel) !== 0 ? String(i.minStockLevel) : "",
    );
    setLowStockTouched(false);
    const isRm = i.itemType === "RM";
    if (i.planningBufferPercent != null && String(i.planningBufferPercent).trim() !== "") {
      setBufferPct(String(i.planningBufferPercent));
    } else {
      setBufferPct(isRm ? "0" : "");
    }
    setHsnCode(i.hsnCode?.trim() ?? "");
    const gr = i.gstRate;
    setGstRateStr(gr != null && String(gr).trim() !== "" ? String(gr) : "");
    setMinimumStock(i.minimumStockQty != null && String(i.minimumStockQty).trim() !== "" ? String(i.minimumStockQty) : "");
    setTargetStock(i.reorderQty != null && String(i.reorderQty).trim() !== "" ? String(i.reorderQty) : "");
    setCriticalCoveragePct(i.redThresholdPercent != null && String(i.redThresholdPercent).trim() !== "" ? String(i.redThresholdPercent) : "50");
    setWarningCoveragePct(i.yellowThresholdPercent != null && String(i.yellowThresholdPercent).trim() !== "" ? String(i.yellowThresholdPercent) : "80");
    // Editing: collapse only when tax info already exists; otherwise keep it open so it’s discoverable.
    const hasTaxInfo = Boolean((i.hsnCode ?? "").trim()) && Boolean(String(i.gstRate ?? "").trim());
    setTaxOpen(!hasTaxInfo);
    setPlanningOpen(false);
    setShowForm(true);
  }

  function closeForm() {
    setError(null);
    setShowForm(false);
    setEditingId(null);
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
    if (Number.isNaN(lowNum) || lowNum < 0) {
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
    try {
      minimumStockQtyPayload = parseOptionalQty(minimumStock);
      if (isRmStockForm) {
        reorderQtyPayload = parseOptionalQty(targetStock);
        const bufTrim = bufferPct.trim();
        if (bufTrim === "") {
          planningBufferPayload = editingId != null ? null : undefined;
        } else {
          const b = Number(bufTrim);
          if (Number.isNaN(b) || b < 0) throw new Error("Buffer % must be a non-negative number");
          if (b > 100) throw new Error("Buffer % cannot exceed 100");
          planningBufferPayload = b;
        }
      }
      criticalPctPayload = parseCoveragePercent(criticalCoveragePct, "Critical coverage %");
      warningPctPayload = parseCoveragePercent(warningCoveragePct, "Warning coverage %");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid stock control fields");
      return;
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
            // Low stock level (YELLOW)
            minStockLevel: lowNum,
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
            // Low stock level (YELLOW)
            minStockLevel: lowNum,
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

  async function onDelete(id: number) {
    if (!confirm("Delete item?")) return;
    setError(null);
    try {
      await apiFetch(`/api/items/${id}`, { method: "DELETE" });
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

  async function onBulkDeleteConfirm() {
    const ids = bulkSel.getSelectedIdsArray();
    if (ids.length === 0) {
      setBulkDeleteOpen(false);
      return;
    }
    setBulkDeleting(true);
    try {
      const result = await bulkDeleteByIds(ids, (id) =>
        apiFetch(`/api/items/${id}`, { method: "DELETE" }).then(() => undefined),
      );

      await load();
      bulkSel.clear();
      setBulkDeleteOpen(false);

      if (result.failed === 0) {
        toast.showSuccess(`Deleted ${ids.length} record(s).`);
        return;
      }
      if (result.blockedFailures > 0) {
        toast.showInfo(BULK_DELETE_IN_USE_TOAST);
      } else {
        toast.showError("Some records could not be deleted.");
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      {isAdmin ? (
        <PageActions>
          <Button type="button" size="sm" variant="outline" onClick={() => openAdd("RM")}>
            + Raw material
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => openAdd("FG")}>
            + Finished goods
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => openAdd("SFG")}>
            + Semi-finished
          </Button>
        </PageActions>
      ) : null}
      {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      {isAdmin ? (
        <BulkSelectionToolbar
          selectedCount={bulkSel.selectedCount}
          onClear={bulkSel.clear}
          onDeleteClick={() => setBulkDeleteOpen(true)}
          disabled={bulkDeleting}
        />
      ) : null}
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              {isAdmin ? (
                <th className="w-10">
                  <input
                    ref={bulkSel.selectAllRef}
                    type="checkbox"
                    aria-label="Select all items"
                    checked={bulkSel.allSelected}
                    onChange={(e) => bulkSel.toggleSelectAll(e.target.checked)}
                  />
                </th>
              ) : null}
              <th>Item</th>
              <th>Type</th>
              <th>Unit</th>
              <th className="whitespace-nowrap">Stock Status</th>
              <th className="whitespace-nowrap">HSN</th>
              <th className="whitespace-nowrap">GST %</th>
              <th className="whitespace-nowrap">Low Stock Level</th>
              {isAdmin ? <th className="text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              (() => {
                const currentQty = stockByItemId.get(i.id) ?? 0;
                return (
              <tr key={i.id}>
                {isAdmin ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${i.itemName}`}
                      checked={bulkSel.selectedIds.has(i.id)}
                      onChange={(e) => bulkSel.toggleOne(i.id, e.target.checked)}
                    />
                  </td>
                ) : null}
                <td className="font-medium">{i.itemName}</td>
                <td>
                  <Badge
                    variant={i.itemType === "FG" ? "success" : i.itemType === "SFG" ? "info" : "default"}
                  >
                    {i.itemType}
                  </Badge>
                </td>
                <td>{i.unitName?.trim() ? i.unitName : i.unit}</td>
                <td>
                  <ItemStockStatusBadge
                    currentQty={currentQty}
                    minimumStockQty={i.minimumStockQty}
                    minStockLevel={i.minStockLevel}
                  />
                </td>
                <td className="text-slate-600">{i.hsnCode?.trim() ? i.hsnCode : "—"}</td>
                <td className="text-slate-600">{i.gstRate != null && String(i.gstRate).trim() !== "" ? i.gstRate : "—"}</td>
                <td>{i.minStockLevel}</td>
                {isAdmin ? (
                  <td>
                    <div className="erp-table-actions">
                      <Button type="button" size="icon" variant="outline" onClick={() => openEdit(i)} aria-label="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        onClick={() => onDelete(i.id)}
                        aria-label="Delete"
                        title="Items in use (BOM, orders, stock) cannot be deleted."
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
                );
              })()
            ))}
          </tbody>
        </table>
      </div>

      <BulkDeleteConfirmModal
        open={bulkDeleteOpen}
        count={bulkSel.getSelectedIdsArray().length}
        loading={bulkDeleting}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={onBulkDeleteConfirm}
      />

      {showForm ? (
        <ErpModal onClose={closeForm}>
          <Card className="erp-modal-shell flex w-[calc(100vw-2rem)] max-w-[900px] max-h-[85vh] flex-col overflow-hidden">
            <div className="sticky top-0 z-[2] flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900">
                  {editingId != null ? "Edit Item" : "Add Item"}
                </div>
                <div className="text-xs text-slate-500">
                  {creatingType === "FG"
                    ? "Finished goods"
                    : creatingType === "SFG"
                      ? "Semi-finished"
                      : "Raw material"}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={quickFillDefaults}>
                  Quick Fill Defaults
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Close" onClick={closeForm}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <CardContent className="min-h-0 flex-1 p-0">
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
                <div className="relative min-h-0 flex-1">
                  <div
                    ref={itemFormScrollRef}
                    className="min-h-0 h-full overflow-y-auto px-4 py-3 pb-12"
                    style={{ scrollbarGutter: "stable" }}
                  >
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
                                <div className="pt-1">
                                  <Badge variant={creatingType === "FG" ? "success" : "default"}>{creatingType === "FG" ? "FG" : "RM"}</Badge>
                                </div>
                              </div>
                              <div className="erp-form-field">
                                <span className="erp-form-label">Unit</span>
                                <select
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
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="0.01"
                                  className="max-w-[8rem]"
                                  value={gstRateStr}
                                  onChange={(e) => setGstRateStr(e.target.value)}
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
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock Control</div>
                          <div className="mt-2 grid gap-2.5">
                            <div className="grid gap-2.5 sm:grid-cols-2">
                              <div className="erp-form-field">
                                <span className="erp-form-label">Minimum stock</span>
                                <Input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={minimumStock}
                                  onChange={(e) => setMinimumStock(e.target.value)}
                                  placeholder="0"
                                />
                                <p className="mt-1 text-xs text-slate-500">Critical threshold — stock below this is urgent</p>
                              </div>
                              <div className="erp-form-field">
                                <span className="erp-form-label">Low Stock Level</span>
                                <Input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={lowStockAlert}
                                  onChange={(e) => {
                                    setLowStockAlert(e.target.value);
                                    setLowStockTouched(true);
                                  }}
                                  placeholder="0"
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                  {isRmStockForm
                                    ? "Auto-calculated warning level (or manual override)"
                                    : "Optional warning level for on-hand visibility"}
                                </p>
                              </div>
                            </div>

                            {isRmStockForm ? (
                              <div className="grid gap-2.5 sm:grid-cols-2">
                                <div className="erp-form-field">
                                  <span className="erp-form-label">Buffer %</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={200}
                                    step="0.01"
                                    value={bufferPct}
                                    onChange={(e) => setBufferPct(e.target.value)}
                                  />
                                  <p className="mt-1 text-xs text-slate-500">
                                    Warning buffer above minimum (0 = warning at minimum only)
                                  </p>
                                  {lowStockTouched ? (
                                    <button
                                      type="button"
                                      className="mt-1 text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                                      onClick={() => {
                                        setLowStockTouched(false);
                                        const minVal = parseQtyStr(minimumStock);
                                        if (minVal == null || minVal <= 0) return;
                                        setLowStockAlert(
                                          String(
                                            computeDerivedLowStockLevel(minVal, bufferPercentForAutoCalc()),
                                          ),
                                        );
                                      }}
                                    >
                                      Reset to auto
                                    </button>
                                  ) : null}
                                </div>
                                <div className="erp-form-field">
                                  <span className="erp-form-label">Target stock</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={targetStock}
                                    onChange={(e) => setTargetStock(e.target.value)}
                                    placeholder="Optional"
                                  />
                                  <p className="mt-1 text-xs text-slate-500">Replenishment planning hint (RM only)</p>
                                </div>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">
                                Finished goods use simple on-hand thresholds only — RM buffer % and purchase
                                alerts do not apply.
                              </p>
                            )}
                          </div>
                        </div>

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
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="1"
                                  value={criticalCoveragePct}
                                  onChange={(e) => setCriticalCoveragePct(e.target.value)}
                                  placeholder="50"
                                />
                              </div>
                              <div className="erp-form-field">
                                <span className="erp-form-label">Warning below (%)</span>
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="1"
                                  value={warningCoveragePct}
                                  onChange={(e) => setWarningCoveragePct(e.target.value)}
                                  placeholder="80"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1 text-xs text-slate-500">Optional settings</div>
                          )}
                        </div>
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
                                <span>
                                  Low: <span className="tabular-nums font-semibold">{lowVal ?? 0}</span>
                                </span>
                                <span>
                                  Current: <span className="tabular-nums font-semibold">{currentQty}</span>
                                </span>
                              </div>
                            </div>
                            <ItemStockStatusBadge
                              currentQty={currentQty}
                              minimumStockQty={minimumStock}
                              minStockLevel={lowStockAlert}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    {error ? (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
                    ) : null}
                  </div>
                </div>

                <div className="sticky bottom-0 z-[2] border-t border-slate-200 bg-white px-4 py-3 shadow-[0_-8px_16px_-16px_rgba(0,0,0,0.55)]">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving..." : editingId != null ? "Save" : "Create"}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
    </div>
  );
}

