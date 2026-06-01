import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { Trash2, X, Search } from "lucide-react";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import {
  CommercialWorkflowStrip,
  commercialStageFromEnquiryContext,
  commercialWorkflowStripDenseFramedClassName,
} from "../components/erp/CommercialWorkflowStrip";
import { NO_QTY_TERMS } from "../lib/flowTerminology";
import { ErpModal } from "../components/erp/ErpModal";

/** Must match backend `enquiries.js` validation message. */
const ENQUIRY_DUPLICATE_ITEM_MESSAGE =
  "The same item cannot be added more than once in one enquiry.";

function enquiryLinesHaveDuplicateItem(lines: readonly { itemId: number }[]): boolean {
  const ids = lines.map((l) => l.itemId);
  return new Set(ids).size !== ids.length;
}

/** Items selectable on this row: current row's item, or any item not used on another row. */
function itemOptionsForLine(items: Item[], lines: { itemId: number }[], rowIndex: number): Item[] {
  return items.filter((it) => {
    const cur = lines[rowIndex]?.itemId;
    if (it.id === cur) return true;
    return !lines.some((l, j) => j !== rowIndex && l.itemId === it.id);
  });
}

type Customer = { id: number; name: string };
type Item = { id: number; itemName: string };

type EnquiryStatus =
  | "DRAFT"
  | "OPEN"
  | "PENDING"
  | "FEASIBLE"
  | "NOT_FEASIBLE"
  | "QUOTED"
  | "PO_RECEIVED"
  | "CLOSED";

type LinkedQuotation = { id: number };

type EnquiryRow = {
  id: number;
  flowType?: "REGULAR" | "NO_QTY";
  status: EnquiryStatus;
  remarks?: string | null;
  createdAt: string;
  customer: Customer;
  lines: { id: number; item: Item; qty: string }[];
  feasibility: { status: string; remarks: string | null } | null;
  quotation: LinkedQuotation | null;
};

type FlowFilter = "ALL" | "REGULAR" | "NO_QTY";
type StatusFilter = "ALL" | EnquiryStatus;
type PanelMode = "idle" | "new" | "feasibility" | "details";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "PENDING", label: "Pending" },
  { value: "FEASIBLE", label: "Feasible" },
  { value: "NOT_FEASIBLE", label: "Not feasible" },
  { value: "QUOTED", label: "Quoted" },
  { value: "PO_RECEIVED", label: "PO received" },
  { value: "CLOSED", label: "Closed" },
];

/** Prominent flow picker for the New Enquiry draft — operators must not miss REGULAR vs NO_QTY. */
function NewEnquiryFlowTypePicker(props: {
  value: "REGULAR" | "NO_QTY";
  onChange: (v: "REGULAR" | "NO_QTY") => void;
}) {
  const { value, onChange } = props;
  const opts: {
    v: "REGULAR" | "NO_QTY";
    title: string;
    helper: string;
    tone: string;
    selectedTone: string;
  }[] = [
    {
      v: "REGULAR",
      title: "REGULAR Order",
      helper: "Fixed customer PO quantity",
      tone: "border-slate-200 bg-white hover:border-blue-200",
      selectedTone: "border-blue-600 bg-blue-50 ring-2 ring-blue-200",
    },
    {
      v: "NO_QTY",
      title: NO_QTY_TERMS.AGREEMENT_LABEL,
      helper: NO_QTY_TERMS.PLANNING_HELPER,
      tone: "border-slate-200 bg-white hover:border-amber-200",
      selectedTone: "border-amber-600 bg-amber-50 ring-2 ring-amber-200",
    },
  ];
  const selected = opts.find((o) => o.v === value) ?? opts[0];
  return (
    <div className="grid gap-2">
      <div
        className={[
          "rounded-md border px-2.5 py-1.5 text-[12px] font-semibold leading-snug",
          value === "REGULAR" ? "border-blue-300 bg-blue-50 text-blue-950" : "border-amber-300 bg-amber-50 text-amber-950",
        ].join(" ")}
        aria-live="polite"
      >
        Selected Flow: {selected.title}
      </div>
      <div role="radiogroup" aria-label="Enquiry flow type" className="grid gap-2 sm:grid-cols-2">
        {opts.map((o) => {
          const isSelected = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={[
                "rounded-md border px-2.5 py-2 text-left transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
                isSelected ? o.selectedTone : o.tone,
              ].join(" ")}
              onClick={() => onChange(o.v)}
            >
              <div className="text-[12px] font-semibold text-slate-900">{o.title}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-slate-600">{o.helper}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FlowTypeSegmentedControl(props: {
  value: "REGULAR" | "NO_QTY";
  onChange: (v: "REGULAR" | "NO_QTY") => void;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const { value, onChange, disabled, disabledTitle } = props;
  return (
    <div
      role="radiogroup"
      aria-label="Flow type"
      title={disabled ? disabledTitle : undefined}
      className={[
        "inline-flex h-8 items-center rounded-full border border-slate-200 bg-slate-50 p-0.5 shadow-sm",
        disabled ? "opacity-60" : "",
      ].join(" ")}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === "REGULAR"}
        disabled={disabled}
        className={[
          "h-7 rounded-full px-3 text-[11px] font-semibold transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
          value === "REGULAR"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:bg-white/60 hover:text-slate-800",
          disabled ? "cursor-not-allowed" : "",
        ].join(" ")}
        onClick={() => onChange("REGULAR")}
      >
        REGULAR
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "NO_QTY"}
        disabled={disabled}
        className={[
          "h-7 rounded-full px-3 text-[11px] font-semibold transition",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
          value === "NO_QTY"
            ? "bg-white text-slate-900 shadow-sm"
            : "text-slate-600 hover:bg-white/60 hover:text-slate-800",
          disabled ? "cursor-not-allowed" : "",
        ].join(" ")}
        onClick={() => onChange("NO_QTY")}
        title={NO_QTY_TERMS.AGREEMENT_LABEL}
      >
        Agreement
      </button>
    </div>
  );
}

function FlowFilterSegmented(props: { value: FlowFilter; onChange: (v: FlowFilter) => void }) {
  const { value, onChange } = props;
  const opts: { v: FlowFilter; label: string }[] = [
    { v: "ALL", label: "All" },
    { v: "REGULAR", label: "REGULAR" },
    { v: "NO_QTY", label: NO_QTY_TERMS.AGREEMENT_LABEL },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Flow filter"
      className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 shadow-sm"
    >
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          className={[
            "h-7 rounded-[5px] px-2.5 text-[11px] font-semibold transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            value === o.v
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:bg-white/60 hover:text-slate-800",
          ].join(" ")}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function flowTypeBadge(flowType: EnquiryRow["flowType"]) {
  const ft = flowType ?? "REGULAR";
  const label = ft === "NO_QTY" ? NO_QTY_TERMS.AGREEMENT_LABEL : "REGULAR";
  const variant: "info" | "warning" = ft === "NO_QTY" ? "warning" : "info";
  return <Badge variant={variant}>{label}</Badge>;
}

function statusBadge(status: EnquiryStatus) {
  const map: Record<string, "default" | "success" | "warning" | "rejected"> = {
    DRAFT: "warning",
    OPEN: "warning",
    PENDING: "warning",
    FEASIBLE: "default",
    NOT_FEASIBLE: "rejected",
    QUOTED: "success",
    PO_RECEIVED: "success",
    CLOSED: "default",
  };
  return <Badge variant={map[status] || "default"}>{status.replace(/_/g, " ")}</Badge>;
}

function nextStepLabel(r: EnquiryRow): string {
  if (r.quotation) return "Quotation created";
  if (r.status === "FEASIBLE") return "Create quotation";
  if (["OPEN", "DRAFT", "PENDING"].includes(r.status)) return "Check feasibility";
  if (r.status === "NOT_FEASIBLE") return "—";
  return "—";
}

export function EnquiriesPage() {
  const toast = useToast();
  const isAdmin = useAuth().user?.role === "ADMIN";
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<EnquiryRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  // Toolbar / filter state
  const [flowFilter, setFlowFilter] = React.useState<FlowFilter>("ALL");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("ALL");
  const [search, setSearch] = React.useState("");

  // Workspace panel state
  const [panelMode, setPanelMode] = React.useState<PanelMode>("idle");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  // New-enquiry form state
  const [customerId, setCustomerId] = React.useState(0);
  const [flowType, setFlowType] = React.useState<"REGULAR" | "NO_QTY">("REGULAR");
  const [remarks, setRemarks] = React.useState("");
  const [enqLines, setEnqLines] = React.useState<{ itemId: number; qty: number }[]>([
    { itemId: 0, qty: Number.NaN },
  ]);
  const [creating, setCreating] = React.useState(false);

  const newFormRef = React.useRef<HTMLDivElement | null>(null);
  const customerSelectRef = React.useRef<HTMLSelectElement | null>(null);
  useFastEntryForm({ containerRef: newFormRef, initialFocusRef: customerSelectRef });

  const newItemSelectRefs = React.useRef<Array<HTMLSelectElement | null>>([]);
  const newQtyInputRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  // Edit modal state
  const [editRow, setEditRow] = React.useState<EnquiryRow | null>(null);
  const [editCustomerId, setEditCustomerId] = React.useState(0);
  const [editFlowType, setEditFlowType] = React.useState<"REGULAR" | "NO_QTY">("REGULAR");
  const [editRemarks, setEditRemarks] = React.useState("");
  const [editLines, setEditLines] = React.useState<{ itemId: number; qty: number }[]>([]);
  const [savingEdit, setSavingEdit] = React.useState(false);

  // Feasibility form state (now lives in side panel)
  const [feasRemarks, setFeasRemarks] = React.useState("");
  const [feasBusy, setFeasBusy] = React.useState(false);

  /** List-only refresh — must never touch new-enquiry draft state. */
  async function refreshEnquiryList() {
    const e = await apiFetch<EnquiryRow[]>("/api/enquiries");
    setRows(e);
  }

  async function refresh() {
    const [c, i, e] = await Promise.all([
      apiFetch<Customer[]>("/api/customers"),
      apiFetch<Item[]>("/api/items?type=FG"),
      apiFetch<EnquiryRow[]>("/api/enquiries"),
    ]);
    setCustomers(c);
    setItems(i);
    setRows(e);
    // Draft defaults are applied in mount effects below — not here (avoids stale-closure resets on tab focus).
  }

  React.useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time defaults after master data loads (functional updates — safe across re-renders).
  React.useEffect(() => {
    if (!customers.length) return;
    setCustomerId((prev) => (prev > 0 ? prev : customers[0].id));
  }, [customers]);

  React.useEffect(() => {
    if (!items.length) return;
    setEnqLines((prev) => {
      if (prev.length === 1 && prev[0].itemId === 0) {
        return [{ itemId: items[0].id, qty: prev[0].qty }];
      }
      return prev;
    });
  }, [items]);

  // Keep enquiry table fresh on tab return without resetting operator draft (root cause of lost form).
  React.useEffect(() => {
    function onFocus() {
      refreshEnquiryList().catch(() => {});
    }
    function onVis() {
      if (document.visibilityState === "visible") refreshEnquiryList().catch(() => {});
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  function resetNewForm() {
    setFlowType("REGULAR");
    setRemarks("");
    setCustomerId(customers[0]?.id ?? 0);
    setEnqLines([{ itemId: items[0]?.id ?? 0, qty: Number.NaN }]);
  }

  async function onCreate() {
    setError(null);
    if (enquiryLinesHaveDuplicateItem(enqLines)) {
      setError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      toast.showError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      return;
    }
    if (flowType === "REGULAR") {
      for (const l of enqLines) {
        const q = Number(l.qty);
        if (!Number.isFinite(q) || q <= 0) {
          setError("Quantity must be greater than zero for each enquiry line.");
          toast.showError("Quantity must be greater than zero for each enquiry line.");
          return;
        }
      }
    }
    setCreating(true);
    try {
      await apiFetch("/api/enquiries", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          flowType,
          remarks: remarks.trim() || undefined,
          lines:
            flowType === "NO_QTY"
              ? enqLines.map((l) => ({ itemId: l.itemId }))
              : enqLines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
        }),
      });
      resetNewForm();
      await refresh();
      setPanelMode("idle");
      toast.showSuccess("Enquiry saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(r: EnquiryRow) {
    setError(null);
    setEditRow(r);
    setEditCustomerId(r.customer.id);
    setEditFlowType((r.flowType ?? "REGULAR") === "NO_QTY" ? "NO_QTY" : "REGULAR");
    setEditRemarks(r.remarks ?? "");
    setEditLines(r.lines.map((l) => ({ itemId: l.item.id, qty: Number(l.qty) })));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editRow) return;
    setError(null);
    if (enquiryLinesHaveDuplicateItem(editLines)) {
      setError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      toast.showError(ENQUIRY_DUPLICATE_ITEM_MESSAGE);
      return;
    }
    if (editFlowType === "REGULAR") {
      for (const l of editLines) {
        const q = Number(l.qty);
        if (!Number.isFinite(q) || q <= 0) {
          setError("Quantity must be greater than zero for each enquiry line.");
          toast.showError("Quantity must be greater than zero for each enquiry line.");
          return;
        }
      }
    }
    setSavingEdit(true);
    try {
      await apiFetch(`/api/enquiries/${editRow.id}`, {
        method: "PUT",
        body: JSON.stringify({
          customerId: editCustomerId,
          flowType: editFlowType,
          remarks: editRemarks.trim() || null,
          lines:
            editFlowType === "NO_QTY"
              ? editLines.map((l) => ({ itemId: l.itemId }))
              : editLines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
        }),
      });
      setEditRow(null);
      await refresh();
      toast.showSuccess("Saved successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this enquiry?")) return;
    try {
      await apiFetch(`/api/enquiries/${id}`, { method: "DELETE" });
      await refresh();
      if (selectedId === id) {
        setSelectedId(null);
        setPanelMode("idle");
      }
      toast.showSuccess("Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function applyFeasibility(id: number, outcome: "feasible" | "not_feasible") {
    setFeasBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/enquiries/${id}/feasibility`, {
        method: "PUT",
        body: JSON.stringify({ outcome, remarks: feasRemarks.trim() || undefined }),
      });
      setFeasRemarks("");
      await refresh();
      // Keep the same enquiry selected; transition to details so user can flow into quotation.
      setPanelMode("details");
      toast.showSuccess("Feasibility updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setFeasBusy(false);
    }
  }

  const canFeasibility = (s: EnquiryStatus) =>
    ["OPEN", "DRAFT", "PENDING", "FEASIBLE", "NOT_FEASIBLE"].includes(s);

  function openNewPanel() {
    setError(null);
    setSelectedId(null);
    setFeasRemarks("");
    setPanelMode("new");
  }

  function openDetails(r: EnquiryRow) {
    setError(null);
    setSelectedId(r.id);
    setFeasRemarks("");
    setPanelMode("details");
  }

  function openFeasibility(r: EnquiryRow) {
    setError(null);
    setSelectedId(r.id);
    setFeasRemarks(r.feasibility?.remarks ?? "");
    setPanelMode("feasibility");
  }

  function closePanel() {
    if (panelMode === "new") resetNewForm();
    setPanelMode("idle");
    setSelectedId(null);
    setFeasRemarks("");
  }

  // Derived: filtered rows (client-side filter; does not alter API behaviour).
  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (flowFilter !== "ALL" && (r.flowType ?? "REGULAR") !== flowFilter) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (q) {
        const hay = [
          `#${r.id}`,
          String(r.id),
          r.customer.name,
          r.remarks ?? "",
          r.status,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, flowFilter, statusFilter, search]);

  const selectedRow = React.useMemo(
    () => (selectedId == null ? null : rows.find((r) => r.id === selectedId) ?? null),
    [rows, selectedId],
  );

  const isNewPanelOpen = panelMode === "new";
  // One primary CTA per context — avoid duplicate "+ New Enquiry" while draft panel is open.
  const showToolbarNewBtn = !isNewPanelOpen && rows.length > 0;
  const showEmptyListNewBtn = rows.length === 0 && !isNewPanelOpen;

  const commercialWorkflowActive = commercialStageFromEnquiryContext(panelMode, selectedRow);

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-2.5">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-800">
          {error}
        </div>
      ) : null}

      {/* COMPACT HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-base font-semibold text-slate-900">Enquiries</h1>
          <span className="text-[12px] text-slate-500">Track and progress sales enquiries</span>
        </div>
        <CommercialWorkflowStrip
          active={commercialWorkflowActive}
          className={commercialWorkflowStripDenseFramedClassName}
        />
      </div>

      {/* SINGLE-ROW TOOLBAR */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
        {showToolbarNewBtn ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 text-[12px] font-semibold"
              data-testid="open-new-enquiry-btn"
              onClick={openNewPanel}
            >
              + New Enquiry
            </Button>
            <div className="h-5 w-px bg-slate-200" aria-hidden="true" />
          </>
        ) : null}
        <FlowFilterSegmented value={flowFilter} onChange={setFlowFilter} />
        <select
          aria-label="Status filter"
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="relative ml-auto w-full max-w-[16rem]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            placeholder="Search id, customer, remarks…"
            className="h-8 pl-7 text-[12px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* SPLIT WORKSPACE */}
      <div className="erp-workspace-2col min-h-0 flex-1">
        {/* LEFT: dense enquiry table */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Recent Enquiries
            </span>
            <span className="text-[11px] tabular-nums text-slate-500">
              {filteredRows.length} of {rows.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {rows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <div className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {isNewPanelOpen ? "New enquiry in progress" : "No enquiries yet"}
                </div>
                <p className="max-w-sm text-[13px] leading-snug text-slate-600">
                  {isNewPanelOpen
                    ? "Complete the draft in the operator panel on the right. Saved enquiries will appear in this list."
                    : "Create the first enquiry to begin the commercial workflow. The list and workflow actions will appear here."}
                </p>
                {showEmptyListNewBtn ? (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-1 h-8 text-[12px]"
                    data-testid="open-new-enquiry-empty-list-btn"
                    onClick={openNewPanel}
                  >
                    + New Enquiry
                  </Button>
                ) : null}
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
                <p className="text-[13px] text-slate-600">No enquiries match the current filter.</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-[12px]"
                  onClick={() => {
                    setFlowFilter("ALL");
                    setStatusFilter("ALL");
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <table className="erp-table erp-table-dense enquiries-workspace-table w-full">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="w-[5.5rem]">ID</th>
                    <th className="w-[6.5rem]">Date</th>
                    <th>Customer</th>
                    <th className="w-[5rem]">Type</th>
                    <th className="w-[8rem]">Status</th>
                    <th className="w-[10rem]">Next Step</th>
                    <th className="erp-table-action-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const primaryIsFeas =
                      canFeasibility(r.status) && !r.quotation && r.status !== "FEASIBLE";
                    const primaryIsCreateQuote = r.status === "FEASIBLE" && !r.quotation;
                    const primaryIsViewQuote = Boolean(r.quotation);
                    const isSelected = r.id === selectedId;

                    return (
                      <tr
                        key={r.id}
                        onClick={() => openDetails(r)}
                        className={[
                          "cursor-pointer transition-colors",
                          isSelected
                            ? "!bg-blue-50/70 outline outline-1 -outline-offset-1 outline-blue-200"
                            : "hover:bg-slate-50/70",
                        ].join(" ")}
                      >
                        <td className="font-medium">#{r.id}</td>
                        <td className="whitespace-nowrap text-slate-600">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                        <td className="min-w-[10rem] truncate">{r.customer.name}</td>
                        <td>{flowTypeBadge(r.flowType)}</td>
                        <td>{statusBadge(r.status)}</td>
                        <td className="text-[12px] text-slate-700">{nextStepLabel(r)}</td>
                        <td
                          className="erp-table-action-col"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="erp-table-actions">
                            {primaryIsCreateQuote || primaryIsViewQuote ? (
                              <button
                                type="button"
                                data-testid={
                                  primaryIsViewQuote ? "next-view-quotation" : "next-create-quotation"
                                }
                                className="erp-table-act erp-table-act--link text-[11px]"
                                onClick={() => openDetails(r)}
                              >
                                Quotation
                              </button>
                            ) : primaryIsFeas ? (
                              <button
                                type="button"
                                data-testid="enquiry-check-feasibility-btn"
                                className="erp-table-act erp-table-act--link text-[11px]"
                                onClick={() => openFeasibility(r)}
                              >
                                Feasibility
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">—</span>
                            )}

                            {isAdmin && !r.quotation ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 shrink-0 whitespace-nowrap px-2 text-[12px] leading-none"
                                  onClick={() => openEdit(r)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="destructive"
                                  className="h-7 w-7"
                                  aria-label="Delete"
                                  onClick={() => onDelete(r.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: operator action workspace */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-3 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Operator Action
                </span>
                <span className="text-[12px] font-semibold text-slate-900">
                  {panelMode === "new"
                    ? "New Enquiry"
                    : panelMode === "feasibility"
                      ? "Feasibility Review"
                      : panelMode === "details" && selectedRow
                        ? `Enquiry #${selectedRow.id}`
                        : "Workflow"}
                </span>
              </div>
              {panelMode !== "idle" ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  aria-label="Close panel"
                  onClick={closePanel}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
            {panelMode === "details" && selectedRow ? (
              <div className="mt-0.5 truncate text-[11px] text-slate-600">
                {selectedRow.customer.name} · {nextStepLabel(selectedRow)}
              </div>
            ) : panelMode === "feasibility" && selectedRow ? (
              <div className="mt-0.5 truncate text-[11px] text-slate-600">
                {selectedRow.customer.name} · Decide feasible / not feasible
              </div>
            ) : panelMode === "new" ? (
              <div className="mt-0.5 text-[11px] text-slate-600">
                Capture flow type, customer and items
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {panelMode === "idle" ? (
              <PanelIdleState hasListData={rows.length > 0} />
            ) : panelMode === "new" ? (
              <NewEnquiryPanel
                containerRef={newFormRef}
                customers={customers}
                items={items}
                customerSelectRef={customerSelectRef}
                customerId={customerId}
                setCustomerId={setCustomerId}
                flowType={flowType}
                setFlowType={setFlowType}
                remarks={remarks}
                setRemarks={setRemarks}
                lines={enqLines}
                setLines={setEnqLines}
                creating={creating}
                onCancel={closePanel}
                onSubmit={onCreate}
                itemSelectRefs={newItemSelectRefs}
                qtyInputRefs={newQtyInputRefs}
                onAddLineErrorToast={() =>
                  toast.showError(
                    "Every item is already on this enquiry. Change quantity on an existing line instead of adding the same item again.",
                  )
                }
              />
            ) : panelMode === "feasibility" && selectedRow ? (
              <FeasibilityPanel
                row={selectedRow}
                remarks={feasRemarks}
                setRemarks={setFeasRemarks}
                busy={feasBusy}
                onDecision={(o) => applyFeasibility(selectedRow.id, o)}
                onCancel={closePanel}
              />
            ) : panelMode === "details" && selectedRow ? (
              <DetailsPanel
                row={selectedRow}
                isAdmin={isAdmin}
                onCheckFeasibility={() => openFeasibility(selectedRow)}
                onEdit={() => openEdit(selectedRow)}
                onDelete={() => onDelete(selectedRow.id)}
              />
            ) : (
              <PanelIdleState hasListData={rows.length > 0} />
            )}
          </div>
        </aside>
      </div>

      {/* EDIT MODAL (kept) */}
      {editRow ? (
        <ErpModal onClose={() => setEditRow(null)}>
          <Card className="erp-modal-shell-md max-h-[90vh]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Edit enquiry #{editRow.id}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={saveEdit} className="erp-form min-w-0">
                <div className="erp-form-field">
                  <span className="erp-form-label">Customer</span>
                  <select
                    className="erp-select"
                    value={editCustomerId}
                    onChange={(e) => setEditCustomerId(Number(e.target.value))}
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Flow Type</span>
                  <FlowTypeSegmentedControl
                    value={editFlowType}
                    disabled={Boolean(editRow.quotation)}
                    disabledTitle={
                      editRow.quotation ? "Flow type cannot be changed after quotation creation." : ""
                    }
                    onChange={setEditFlowType}
                  />
                  {editRow.quotation ? (
                    <div className="mt-1 text-xs text-slate-600">
                      Flow type cannot be changed after quotation creation.
                    </div>
                  ) : null}
                </div>
                <div className="erp-form-field">
                  <span className="erp-form-label">Remarks</span>
                  <Input value={editRemarks} onChange={(e) => setEditRemarks(e.target.value)} />
                </div>
                {editLines.map((l, i) => (
                  <div key={`el-${i}`} className="erp-form-line-card space-y-2">
                    <div className="erp-form-field">
                      <span className="erp-form-label">Item</span>
                      <select
                        className="erp-select"
                        value={l.itemId}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEditLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                        }}
                      >
                        {itemOptionsForLine(items, editLines, i).map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemName}
                          </option>
                        ))}
                      </select>
                    </div>
                    {editFlowType === "REGULAR" ? (
                      <div className="erp-form-field max-w-[10rem]">
                        <span className="erp-form-label">Qty</span>
                        <Input
                          type="number"
                          min={0.001}
                          step="any"
                          value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const v = raw.trim() === "" ? Number.NaN : Number(raw);
                            setEditLines((p) => p.map((x, j) => (j === i ? { ...x, qty: v } : x)));
                          }}
                        />
                      </div>
                    ) : null}
                    {editLines.length > 1 ? (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditLines((p) => p.filter((_, j) => j !== i))}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const used = new Set(editLines.map((x) => x.itemId));
                    const nextItem = items.find((it) => !used.has(it.id));
                    if (!nextItem) {
                      toast.showError(
                        "Every item is already on this enquiry. Change quantity on an existing line instead of adding the same item again.",
                      );
                      return;
                    }
                    setEditLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
                  }}
                >
                  Add line
                </Button>
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditRow(null)}
                    disabled={savingEdit}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={savingEdit}>
                    {savingEdit ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right-panel subcomponents (UI-only; no business-logic changes).
// ---------------------------------------------------------------------------

function PanelIdleState(props: { hasListData: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Workflow Action
      </div>
      <p className="max-w-xs text-[13px] leading-snug text-slate-600">
        {props.hasListData
          ? "Select an enquiry from the list to view details and next steps. Use + New Enquiry in the toolbar to start another."
          : "Use + New Enquiry in the list area to open the creation form in this panel."}
      </p>
    </div>
  );
}

function NewEnquiryPanel(props: {
  containerRef: React.Ref<HTMLDivElement>;
  customers: Customer[];
  items: Item[];
  customerSelectRef: React.Ref<HTMLSelectElement>;
  customerId: number;
  setCustomerId: (v: number) => void;
  flowType: "REGULAR" | "NO_QTY";
  setFlowType: (v: "REGULAR" | "NO_QTY") => void;
  remarks: string;
  setRemarks: (v: string) => void;
  lines: { itemId: number; qty: number }[];
  setLines: React.Dispatch<React.SetStateAction<{ itemId: number; qty: number }[]>>;
  creating: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  itemSelectRefs: React.MutableRefObject<Array<HTMLSelectElement | null>>;
  qtyInputRefs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  onAddLineErrorToast: () => void;
}) {
  const {
    containerRef,
    customers,
    items,
    customerSelectRef,
    customerId,
    setCustomerId,
    flowType,
    setFlowType,
    remarks,
    setRemarks,
    lines,
    setLines,
    creating,
    onCancel,
    onSubmit,
    itemSelectRefs,
    qtyInputRefs,
    onAddLineErrorToast,
  } = props;

  return (
    <div ref={containerRef} className="flex flex-col gap-3.5">
      <NewEnquiryFlowTypePicker value={flowType} onChange={setFlowType} />

      <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Customer
        <select
          ref={customerSelectRef}
          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          data-testid="enquiry-customer-select"
          value={customerId}
          onChange={(e) => setCustomerId(Number(e.target.value))}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Remarks (optional)
        <Input
          className="h-8 text-[13px]"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Notes"
        />
      </label>

      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {flowType === "REGULAR" ? "Items & quantity" : "Items (agreement scope)"}
          </span>
          {flowType === "NO_QTY" ? (
            <span className="text-[11px] leading-snug text-amber-800">
              No fixed PO qty — {NO_QTY_TERMS.PLANNING_HELPER.toLowerCase()} in Requirement Sheets
            </span>
          ) : (
            <span className="text-[11px] font-medium text-blue-800">Qty required per line</span>
          )}
        </div>

        {flowType === "REGULAR" ? (
          <>
            <div className="grid grid-cols-12 gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <div className="col-span-7">Item</div>
              <div className="col-span-5">
                Qty <span className="text-red-600">*</span>
              </div>
            </div>
            {lines.map((l, i) => (
              <div key={`nl-${i}`} className="grid grid-cols-12 items-center gap-1.5">
                <div className="col-span-7">
                  <select
                    ref={(el) => {
                      itemSelectRefs.current[i] = el;
                    }}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                    data-testid="enquiry-item-select"
                    value={l.itemId}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                      window.setTimeout(() => qtyInputRefs.current[i]?.focus(), 0);
                    }}
                  >
                    {itemOptionsForLine(items, lines, i).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.itemName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-5 flex items-center gap-1.5">
                  <Input
                    ref={(el) => {
                      qtyInputRefs.current[i] = el;
                    }}
                    className="h-8 text-[13px]"
                    type="number"
                    data-testid="enquiry-qty-input"
                    min={0.001}
                    step="any"
                    value={Number.isFinite(l.qty) ? String(l.qty) : ""}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const used = new Set(lines.map((x) => x.itemId));
                      const nextItem = items.find((it) => !used.has(it.id));
                      if (!nextItem) return;
                      setLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
                      window.setTimeout(() => itemSelectRefs.current[i + 1]?.focus(), 0);
                    }}
                    onChange={(e) => {
                      const raw = (e.target as HTMLInputElement).value;
                      const v = raw.trim() === "" ? Number.NaN : Number(raw);
                      setLines((p) => p.map((x, j) => (j === i ? { ...x, qty: v } : x)));
                    }}
                  />
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 shrink-0"
                      aria-label="Remove item"
                      onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="grid gap-1.5">
            {lines.map((l, i) => (
              <div key={`nl-${i}`} className="flex items-center gap-1.5">
                <select
                  ref={(el) => {
                    itemSelectRefs.current[i] = el;
                  }}
                  className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  data-testid="enquiry-item-select"
                  value={l.itemId}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLines((p) => p.map((x, j) => (j === i ? { ...x, itemId: v } : x)));
                  }}
                >
                  {itemOptionsForLine(items, lines, i).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.itemName}
                    </option>
                  ))}
                </select>
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0"
                    aria-label="Remove item"
                    onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          data-testid="enquiry-add-line-btn"
          className="self-start text-[12px] font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800"
          onClick={() => {
            const used = new Set(lines.map((x) => x.itemId));
            const nextItem = items.find((it) => !used.has(it.id));
            if (!nextItem) {
              onAddLineErrorToast();
              return;
            }
            setLines((p) => [...p, { itemId: nextItem.id, qty: Number.NaN }]);
            window.setTimeout(() => itemSelectRefs.current[lines.length]?.focus(), 0);
          }}
        >
          + Add another item
        </button>
      </div>

      <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <Button type="button" variant="outline" size="sm" className="h-8 text-[12px]" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-[12px]"
          data-testid="create-enquiry-btn"
          onClick={onSubmit}
          disabled={creating}
        >
          {creating ? "Saving…" : "Create Enquiry"}
        </Button>
      </div>
    </div>
  );
}

function FeasibilityPanel(props: {
  row: EnquiryRow;
  remarks: string;
  setRemarks: (v: string) => void;
  busy: boolean;
  onDecision: (outcome: "feasible" | "not_feasible") => void;
  onCancel: () => void;
}) {
  const { row, remarks, setRemarks, busy, onDecision, onCancel } = props;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="rounded-md border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-[12px] text-slate-700">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-slate-900">#{row.id}</span>
          <span className="text-slate-400">·</span>
          <span>{row.customer.name}</span>
          <span className="text-slate-400">·</span>
          {flowTypeBadge(row.flowType)}
          {statusBadge(row.status)}
        </div>
        {row.lines.length ? (
          <div className="mt-1.5 text-[11px] text-slate-600">
            {row.lines.length} item{row.lines.length === 1 ? "" : "s"}
          </div>
        ) : null}
      </div>

      <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Remarks
        <textarea
          className="min-h-[6rem] w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          placeholder="Reason / notes for this decision"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </label>

      <div className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={busy}
          onClick={() => onDecision("not_feasible")}
        >
          Not feasible
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 min-w-[7rem] text-[12px] font-semibold shadow-sm"
          disabled={busy}
          onClick={() => onDecision("feasible")}
        >
          {busy ? "Saving…" : "Feasible →"}
        </Button>
      </div>
    </div>
  );
}

function DetailsPanel(props: {
  row: EnquiryRow;
  isAdmin: boolean;
  onCheckFeasibility: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { row, isAdmin, onCheckFeasibility, onEdit, onDelete } = props;
  const showFeas =
    ["OPEN", "DRAFT", "PENDING", "FEASIBLE", "NOT_FEASIBLE"].includes(row.status) &&
    !row.quotation &&
    row.status !== "FEASIBLE";
  const showCreateQuote = row.status === "FEASIBLE" && !row.quotation;
  const showViewQuote = Boolean(row.quotation);

  // Next-action hero copy + visual tone
  const nextActionTone: "primary" | "neutral" =
    showFeas || showCreateQuote || showViewQuote ? "primary" : "neutral";
  const nextActionTitle = showCreateQuote
    ? "Create quotation"
    : showViewQuote
      ? "Quotation created"
      : showFeas
        ? "Check feasibility"
        : row.status === "NOT_FEASIBLE"
          ? "Marked not feasible"
          : "No further action";
  const nextActionSub = showCreateQuote
    ? "Feasibility approved — proceed to quotation."
    : showViewQuote
      ? "Continue on the Quotations workspace."
      : showFeas
        ? "Decide feasible / not feasible for this enquiry."
        : row.status === "NOT_FEASIBLE"
          ? "Reopen feasibility from history if needed."
          : "Workflow complete for this enquiry.";

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Next-action hero */}
      <div
        className={[
          "rounded-md border px-3 py-2 shadow-sm",
          nextActionTone === "primary"
            ? "border-blue-200 bg-gradient-to-br from-blue-50 to-white"
            : "border-slate-200 bg-slate-50",
        ].join(" ")}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Next action
        </div>
        <div
          className={[
            "mt-0.5 text-[14px] font-semibold leading-snug",
            nextActionTone === "primary" ? "text-blue-900" : "text-slate-700",
          ].join(" ")}
        >
          {nextActionTitle}
        </div>
        <div className="text-[11px] leading-snug text-slate-600">{nextActionSub}</div>
      </div>

      {/* Compact summary chip */}
      <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">#{row.id}</span>
          <span className="text-slate-400">·</span>
          <span>{new Date(row.createdAt).toLocaleDateString()}</span>
          {flowTypeBadge(row.flowType)}
          {statusBadge(row.status)}
        </div>
        <div className="mt-1 truncate text-[13px] font-medium text-slate-900">{row.customer.name}</div>
        {row.remarks ? <div className="mt-0.5 text-[11px] text-slate-600">{row.remarks}</div> : null}
      </div>

      {/* Items */}
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Items ({row.lines.length})
        </div>
        <div className="overflow-hidden rounded-md border border-slate-200">
          <table className="erp-table erp-table-dense w-full">
            <thead>
              <tr>
                <th>Item</th>
                <th className="w-[5rem] text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {row.lines.map((l) => (
                <tr key={l.id}>
                  <td className="truncate">{l.item.itemName}</td>
                  <td className="text-right tabular-nums">
                    {row.flowType === "NO_QTY" ? "—" : l.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {row.feasibility ? (
        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Feasibility
          </div>
          <div className="mt-0.5">
            <span className="font-medium text-slate-800">{row.feasibility.status}</span>
            {row.feasibility.remarks ? (
              <span className="text-slate-600"> — {row.feasibility.remarks}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Sticky action footer — primary action dominates */}
      <div className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        {isAdmin && !row.quotation ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-[12px]"
              onClick={onEdit}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 text-[12px]"
              onClick={onDelete}
            >
              Delete
            </Button>
          </>
        ) : null}
        {showFeas ? (
          <Button
            type="button"
            size="sm"
            className="h-8 min-w-[8rem] text-[12px] font-semibold shadow-sm"
            data-testid="enquiry-check-feasibility-btn"
            onClick={onCheckFeasibility}
          >
            Check feasibility →
          </Button>
        ) : null}
        {showCreateQuote ? (
          <Link
            to={`/quotations/new?enquiryId=${row.id}`}
            data-testid="next-create-quotation"
            className="inline-flex h-8 min-w-[8.5rem] items-center justify-center rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            Create quotation →
          </Link>
        ) : null}
        {showViewQuote && row.quotation ? (
          <Link
            to={`/quotations#quotation-row-${row.quotation.id}`}
            data-testid="next-view-quotation"
            className="inline-flex h-8 min-w-[8rem] items-center justify-center rounded-md bg-blue-600 px-3 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700"
          >
            View quotation →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
