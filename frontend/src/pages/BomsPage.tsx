import * as React from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Link } from "react-router-dom";
import { PageContainer } from "../components/PageHeader";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useIsAdmin } from "../hooks/useIsAdmin";
import {
  computedBomSummary,
  bomLineQuantitiesFromMixPercent,
  bomMixPercentFromKg,
  fgWeightInGrams,
  type BomPlanningResult,
  type BomNormalizationMode,
} from "../lib/bomMath";
import { cn } from "../lib/utils";
import { erpTable } from "../lib/erpFoundationTokens";
import { ArrowLeft, Ban, CheckCircle2, Copy, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useToast } from "../contexts/ToastContext";
import { ErpModal } from "../components/erp/ErpModal";
type Item = { id: number; itemName: string; itemType: string; unit: string };
type UnitRow = { id: number; unitName: string; unitCode?: string | null };
type BomComponentType = "RM" | "SFG" | "CONSUMABLE";

type BomLine = {
  id: number;
  rmItemId: number;
  baseQty: string;
  notes?: string | null;
  rmItem: Item;
  componentType?: BomComponentType;
  childBomAvailable?: boolean | null;
  childBom?: { id: number; docNo?: string | null; revisionNo?: number; revisionLabel?: string } | null;
  effectiveQty?: number;
  rmRequiredPerFg?: number;
  rmRequiredFor1000Fg?: number;
  rmRequiredFor10000Fg?: number;
};

type BomComponentSummary = {
  rmCount: number;
  sfgCount: number;
  consumableCount: number;
  childBomsLinked: number;
  sfgWarnings: string[];
};
type BomPlanning = BomPlanningResult;
type BomType = "STANDARD" | "APPROXIMATE" | "CUSTOMER_SPECIFIC";
type BomStatus = "DRAFT" | "APPROVED" | "INACTIVE" | "ARCHIVED";

type BomRow = {
  id: number;
  fgItemId: number;
  fgItem: Item;
  lines: BomLine[];
  docNo?: string | null;
  bomType?: BomType;
  status?: BomStatus;
  normalizationMode?: BomNormalizationMode;
  revisionNo?: number;
  revisionLabel?: string;
  effectiveFrom?: string | null;
  remarks?: string | null;
  approvedAt?: string | null;
  fgWeight?: string | null;
  fgWeightUnitId?: number | null;
  fgWeightUnit?: UnitRow | null;
  outputQty?: string;
  processLossPercent?: string;
  qcLossPercent?: string;
  suggestedFgPlanningBufferPercent?: string | null;
  planning?: BomPlanning;
  componentSummary?: BomComponentSummary;
  approvalWarnings?: string[];
  isLocked?: boolean;
  lockedAt?: string | null;
  updatedAt?: string;
};

type HeaderDraft = {
  fgWeight: NumberDraft;
  fgWeightUnitId: number | "";
  outputQty: NumberDraft;
  processLossPercent: NumberDraft;
  qcLossPercent: NumberDraft;
  suggestedFgPlanningBufferPercent: NumberDraft;
  bomType: BomType;
  effectiveFrom: string;
  remarks: string;
};

type LineDraft = {
  rmItemId: number;
  mixPercent: number | "";
  notes: string;
};

function itemDisplayCode(itemId: number) {
  return `ITM-${String(itemId).padStart(5, "0")}`;
}

function bomStatusLabel(status?: BomStatus) {
  if (status === "APPROVED") return "Approved";
  if (status === "INACTIVE") return "Inactive";
  if (status === "ARCHIVED") return "Archived";
  return "Draft";
}

function bomRevisionLabel(revisionNo?: number) {
  return `R${revisionNo ?? 1}`;
}

function bomDisplayRevision(docNo?: string | null, revisionNo?: number) {
  const rev = bomRevisionLabel(revisionNo);
  return docNo ? `${docNo} / ${rev}` : rev;
}

function bomAppearsLocked(b: Pick<BomRow, "isLocked" | "status">) {
  return b.status === "APPROVED" || (b.status == null && b.isLocked !== false);
}

function bomTypeLabel(t?: BomType) {
  if (t === "APPROXIMATE") return "Approximate";
  if (t === "CUSTOMER_SPECIFIC") return "Customer specific";
  return "Standard";
}

function lineComponentType(item: Item | undefined, line?: Pick<BomLine, "componentType">): BomComponentType {
  if (line?.componentType) return line.componentType;
  const t = String(item?.itemType ?? "RM").toUpperCase();
  if (t === "SFG") return "SFG";
  if (t === "CONSUMABLE") return "CONSUMABLE";
  return "RM";
}

function componentTypeChipClass(t: BomComponentType) {
  if (t === "SFG") return "bg-sky-100 text-sky-800 ring-sky-200/80";
  if (t === "CONSUMABLE") return "bg-violet-100 text-violet-800 ring-violet-200/80";
  return "bg-slate-100 text-slate-700 ring-slate-200/80";
}

function BomComponentTypeChip({ type }: { type: BomComponentType }) {
  const label = type === "CONSUMABLE" ? "Consumable" : type;
  return (
    <span
      className={cn(
        "inline-flex rounded px-1 py-0 text-[9px] font-bold uppercase tracking-wide ring-1",
        componentTypeChipClass(type),
      )}
    >
      {label}
    </span>
  );
}

function SfgChildBomHint({
  itemId,
  itemType,
  line,
  approvedChildFgIds,
}: {
  itemId: number;
  itemType: string;
  line?: Pick<BomLine, "childBomAvailable" | "componentType">;
  approvedChildFgIds: Set<number>;
}) {
  const ct = lineComponentType({ id: itemId, itemName: "", itemType, unit: "" }, line);
  if (ct !== "SFG") return null;
  const hasBom = line?.childBomAvailable ?? approvedChildFgIds.has(itemId);
  return (
    <span className={cn("ml-1 text-[9px] font-semibold", hasBom ? "text-emerald-700" : "text-amber-700")}>
      {hasBom ? "✓ BOM" : "⚠ No BOM"}
    </span>
  );
}

const opInputClass = "h-7 min-h-7 py-0.5 text-xs tabular-nums";
const opSelectClass =
  "erp-select !h-7 min-h-7 py-0.5 text-xs leading-tight ring-offset-white focus-visible:ring-offset-1";
function BomCell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("bom-cell min-w-0", className)}>
      <span className="bom-cell__label">{label}</span>
      {children}
    </label>
  );
}

function defaultHeaderDraft(): HeaderDraft {
  return {
    fgWeight: "",
    fgWeightUnitId: "",
    outputQty: 1,
    processLossPercent: "",
    qcLossPercent: "",
    suggestedFgPlanningBufferPercent: "",
    bomType: "STANDARD",
    effectiveFrom: "",
    remarks: "",
  };
}

function headerFromBom(b: BomRow): HeaderDraft {
  const fw = b.fgWeight != null ? Number(b.fgWeight) : NaN;
  const oq = b.outputQty != null ? Number(b.outputQty) : 1;
  const pl = Number(b.processLossPercent ?? 0);
  const ql = Number(b.qcLossPercent ?? 0);
  const sb =
    b.suggestedFgPlanningBufferPercent != null ? Number(b.suggestedFgPlanningBufferPercent) : NaN;
  const eff = b.effectiveFrom ? String(b.effectiveFrom).slice(0, 10) : "";
  return {
    fgWeight: Number.isFinite(fw) && fw > 0 ? fw : "",
    fgWeightUnitId: b.fgWeightUnitId ?? "",
    outputQty: Number.isFinite(oq) && oq > 0 ? oq : 1,
    processLossPercent: pl > 0 ? pl : "",
    qcLossPercent: ql > 0 ? ql : "",
    suggestedFgPlanningBufferPercent: Number.isFinite(sb) && sb >= 0 ? sb : "",
    bomType: b.bomType ?? "STANDARD",
    effectiveFrom: eff,
    remarks: b.remarks ?? "",
  };
}

function lineFromBom(b: BomRow, line: BomLine): LineDraft {
  const fw = b.fgWeight != null ? Number(b.fgWeight) : NaN;
  const weightUnit = b.fgWeightUnit ?? null;
  const baseQtyKg = Number(line.baseQty ?? 0);
  const outputQty = Number(b.outputQty ?? 1);
  const mixPercent =
    Number.isFinite(fw) && fw > 0
      ? bomMixPercentFromKg(baseQtyKg, fw, weightUnit, outputQty, b.normalizationMode ?? "PER_PIECE")
      : null;
  return {
    rmItemId: line.rmItemId,
    mixPercent: mixPercent != null && Number.isFinite(mixPercent) ? mixPercent : "",
    notes: line.notes ?? "",
  };
}

function headerNums(h: HeaderDraft) {
  return {
    fgWeight: h.fgWeight === "" ? null : Number(h.fgWeight),
    fgWeightUnitId: h.fgWeightUnitId === "" ? null : Number(h.fgWeightUnitId),
    outputQty: h.outputQty === "" ? 1 : Number(h.outputQty),
    processLossPercent: h.processLossPercent === "" ? 0 : Number(h.processLossPercent),
    qcLossPercent: h.qcLossPercent === "" ? 0 : Number(h.qcLossPercent),
    suggestedFgPlanningBufferPercent:
      h.suggestedFgPlanningBufferPercent === "" ? null : Number(h.suggestedFgPlanningBufferPercent),
  };
}

function mixPercentError(l: LineDraft, strict = true): string | null {
  if (l.mixPercent === "") return strict ? "Enter mix % for each line." : null;
  const n = typeof l.mixPercent === "number" ? l.mixPercent : Number(l.mixPercent);
  if (!Number.isFinite(n)) return "Mix % must be a valid number.";
  if (n <= 0) return "Mix % must be greater than 0.";
  if (n > 100) return "Mix % cannot exceed 100.";
  return null;
}

function fmt3(n: number) {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, "");
}

function fmtIntish(n: number) {
  return n >= 100 ? n.toFixed(0) : fmt3(n);
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function newBlankLine(rmItemId: number): LineDraft {
  return { rmItemId, mixPercent: "", notes: "" };
}

type WorkspaceMode = "idle" | "create" | "edit" | "view";

function draftSnapshot(fgId: number, header: HeaderDraft, lines: LineDraft[]) {
  return JSON.stringify({
    fgId,
    header,
    lines: lines.map((l) => ({ rmItemId: l.rmItemId, mixPercent: l.mixPercent, notes: l.notes })),
  });
}

function firstFgWithoutBom(fgs: Item[], rows: BomRow[]) {
  return fgs.find((f) => !rows.some((r) => r.fgItemId === f.id && (r.status === "DRAFT" || r.status === "APPROVED"))) ?? null;
}

type BomCardTone = "primary" | "secondary" | "grid" | "insights";

function BomSectionCard({
  title,
  headAction,
  children,
  className,
  tone = "primary",
  ...rest
}: {
  title: string;
  headAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: BomCardTone;
} & Omit<React.ComponentPropsWithoutRef<"section">, "children" | "className">) {
  const toneClass =
    tone === "insights"
      ? "bom-op-card--insights"
      : tone === "grid"
        ? "bom-op-card--grid"
        : tone === "secondary"
          ? "bom-op-card--secondary"
          : "bom-op-card--primary";
  return (
    <section className={cn("bom-op-card min-w-0", toneClass, className)} {...rest}>
      <div className="bom-op-card-head">
        <h3 className="bom-op-card-head-title">{title}</h3>
        {headAction}
      </div>
      <div className="bom-op-card-body">{children}</div>
    </section>
  );
}

function BomPageHeader({
  showToolbar,
  saveDisabled,
  addRmDisabled,
  onNewDraft,
  onSaveDraft,
  onAddRm,
}: {
  showToolbar: boolean;
  saveDisabled: boolean;
  addRmDisabled: boolean;
  onNewDraft: () => void;
  onSaveDraft: () => void;
  onAddRm: () => void;
}) {
  return (
    <header className="bom-vp-head">
      <div className="flex min-w-0 items-center gap-2">
        <Link to="/dashboard" className="bom-ws-back" aria-label="Back to Dashboard">
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="bom-vp-title">BOM</h1>
          <p className="bom-vp-sub">Factory recipe for material planning</p>
          </div>
          </div>
      {showToolbar ? (
        <div className="bom-vp-toolbar">
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] font-semibold" onClick={onNewDraft}>
            New draft
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-[11px] font-bold"
            disabled={saveDisabled}
            onClick={onSaveDraft}
          >
            Save draft
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px] font-semibold"
            disabled={addRmDisabled}
            onClick={onAddRm}
          >
            <Plus className="mr-0.5 h-3 w-3" aria-hidden />
            Add line
          </Button>
        </div>
      ) : null}
    </header>
  );
}

function BomEmptyState({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
              return (
    <div className="bom-op-card flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
      <h2 className="text-[15px] font-bold text-slate-900">Create new BOM</h2>
      <ol className="mt-3 max-w-sm space-y-1.5 text-left text-[12px] text-slate-600">
        <li>1. Select finished good (FG) item</li>
        <li>2. Add RM consumption lines</li>
        <li>3. Save draft</li>
        <li>4. Approve BOM for production</li>
      </ol>
      <Button type="button" size="sm" className="mt-4 h-8 px-4 text-xs font-bold" disabled={disabled} onClick={onCreate}>
        Create new BOM
      </Button>
        </div>
  );
}

function BomSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bom-summary-row">
      <span className="bom-summary-row__label">{label}</span>
      <span className="bom-summary-row__value">{value}</span>
        </div>
  );
}

function BomSummaryPanel({
  header,
  weightUnit,
  lines,
  fgUnit,
  itemsById,
  componentSummary,
}: {
  header: HeaderDraft;
  weightUnit: UnitRow | null;
  lines: LineDraft[];
  fgUnit: string;
  itemsById: Map<number, Item>;
  componentSummary?: BomComponentSummary;
}) {
  const nums = headerNums(header);
  const summary = computedBomSummary({
    fgWeight: nums.fgWeight,
    fgWeightUnit: weightUnit,
    outputQty: nums.outputQty,
    processLossPercent: nums.processLossPercent,
    qcLossPercent: nums.qcLossPercent,
    lines: lines.map((l) => ({ rmItemId: l.rmItemId, mixPercent: l.mixPercent })),
  });
  const lineSummaries = summary.lineSummaries
    .map((row) => {
      const item = itemsById.get(row.rmItemId);
      if (!item) return null;
      return { item, line: row };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  const summarySfg = componentSummary?.sfgCount ?? lineSummaries.filter((row) => lineComponentType(row.item) === "SFG").length;
  const childLinked = componentSummary?.childBomsLinked ?? 0;

                return (
    <BomSectionCard title="Planning summary" tone="insights">
      <div className="bom-summary-list">
        {!summary.weightConfigured ? (
          <BomSummaryRow label="Warning" value="FG weight is required to derive mix percentages and RM weights." />
        ) : null}
        <BomSummaryRow label="FG weight" value={summary.weightConfigured ? `${fmt3(summary.fgWeightGm ?? 0)} ${summary.weightUnitLabel}` : "—"} />
        <BomSummaryRow
          label="RM composition"
          value={
            lineSummaries.length
              ? lineSummaries.map((row) => `${row.item.itemName} ${row.line.mixPercent != null ? `${fmt3(row.line.mixPercent)}%` : "—"}`).join("  ")
              : "—"
          }
        />
        <BomSummaryRow label="Total composition" value={`${fmt3(summary.totalCompositionPercent)}%`} />
        <BomSummaryRow label="Total RM after wastage" value={`${fmt3(summary.totalRmAfterWastageGm)} gm`} />
        <BomSummaryRow label="FG per KG" value={summary.weightConfigured && summary.possibleFgPerKg != null ? `${fmtIntish(summary.possibleFgPerKg)} Nos` : "—"} />
        <BomSummaryRow label="Output qty" value={`${fmt3(nums.outputQty)} ${fgUnit}`} />
        {summarySfg > 0 ? (
          <BomSummaryRow label="Child BOMs linked" value={String(childLinked)} />
        ) : null}
      </div>
    </BomSectionCard>
  );
}

function BomCompactForm({
  header,
  setHeader,
  docNo,
  revisionLabel,
  fgUnit,
  fgId,
  setFgId,
  fgs,
  weightUnits,
  fgLocked,
  fgSelectRef,
  readOnly,
}: {
  header: HeaderDraft;
  setHeader: React.Dispatch<React.SetStateAction<HeaderDraft>>;
  docNo?: string | null;
  revisionLabel?: string;
  fgUnit: string;
  fgId?: number;
  setFgId?: (id: number) => void;
  fgs: Item[];
  weightUnits: UnitRow[];
  fgLocked?: { name: string; unit: string };
  fgSelectRef?: React.Ref<HTMLSelectElement>;
  readOnly?: boolean;
}) {
  return (
    <BomSectionCard title="Recipe details" tone="primary">
      <div className="bom-compact-grid">
        <BomCell label="BOM number">
          <Input className={cn(opInputClass, "bg-slate-50 font-bold")} readOnly value={docNo ?? "—"} />
        </BomCell>
        <BomCell label="FG item" className="bom-compact-span-2">
          {fgLocked ? (
            <Input className={cn(opInputClass, "bg-slate-50 font-bold")} readOnly value={fgLocked.name} />
          ) : (
            <select
              ref={fgSelectRef}
              className={cn(opSelectClass, "w-full font-semibold")}
              value={fgId}
              disabled={readOnly}
              onChange={(e) => setFgId?.(Number(e.target.value))}
            >
              {fgs.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.itemName}
                </option>
              ))}
            </select>
          )}
        </BomCell>
        <BomCell label="Revision">
          <Input className={cn(opInputClass, "bg-slate-50")} readOnly value={revisionLabel ?? "R1"} />
        </BomCell>
        <BomCell label="BOM type">
          <select
            className={cn(opSelectClass, "w-full")}
            value={header.bomType}
            disabled={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, bomType: e.target.value as BomType }))}
          >
            <option value="STANDARD">Standard</option>
            <option value="APPROXIMATE">Approximate</option>
            <option value="CUSTOMER_SPECIFIC">Customer specific</option>
          </select>
        </BomCell>
        <BomCell label="Effective from">
          <Input
            type="date"
            className={cn(opInputClass, "w-full")}
            value={header.effectiveFrom}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, effectiveFrom: e.target.value }))}
          />
        </BomCell>
        <BomCell label="Output qty (info)">
          <Input
            type="number"
            step="any"
            className={cn(opInputClass, "w-full text-right font-bold")}
            value={header.outputQty}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, outputQty: toNumberDraft(e.target.value) }))}
          />
        </BomCell>
        <BomCell label="UOM">
          <Input className={cn(opInputClass, "bg-slate-50")} readOnly value={fgUnit} />
        </BomCell>
        <BomCell label="FG weight">
          <Input
            type="number"
            step="any"
            className={cn(opInputClass, "w-full text-right")}
            value={header.fgWeight}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, fgWeight: toNumberDraft(e.target.value) }))}
          />
        </BomCell>
        <BomCell label="Weight unit">
          <select
            className={cn(opSelectClass, "w-full")}
            value={header.fgWeightUnitId === "" ? "" : header.fgWeightUnitId}
            disabled={readOnly}
            onChange={(e) => {
              const v = e.target.value;
              setHeader((h) => ({ ...h, fgWeightUnitId: v === "" ? "" : Number(v) }));
            }}
          >
            <option value="">—</option>
            {weightUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.unitName}
              </option>
            ))}
          </select>
        </BomCell>
        <BomCell label="Process wastage %">
          <Input
            type="number"
            step="any"
            className={cn(opInputClass, "w-full text-right")}
            value={header.processLossPercent}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, processLossPercent: toNumberDraft(e.target.value) }))}
          />
        </BomCell>
        <BomCell label="QC allowance %">
          <Input
            type="number"
            step="any"
            className={cn(opInputClass, "w-full text-right")}
            value={header.qcLossPercent}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, qcLossPercent: toNumberDraft(e.target.value) }))}
          />
        </BomCell>
        <BomCell label="Suggested FG planning buffer %">
          <Input
            type="number"
            step="any"
            min={0}
            max={10}
            className={cn(opInputClass, "w-full text-right")}
            value={header.suggestedFgPlanningBufferPercent}
            readOnly={readOnly}
            onChange={(e) =>
              setHeader((h) => ({ ...h, suggestedFgPlanningBufferPercent: toNumberDraft(e.target.value) }))
            }
            placeholder="Optional"
          />
        </BomCell>
        <BomCell label="Notes" className="bom-compact-span-3">
          <Input
            className={cn(opInputClass, "w-full")}
            value={header.remarks}
            readOnly={readOnly}
            onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
            placeholder="Optional"
          />
        </BomCell>
        </div>
    </BomSectionCard>
  );
}

function BomRmWorkspaceTable({
  lines,
  setLines,
  header,
  components,
  itemsById,
  weightUnit,
  formId,
  onAddLine,
  focusLineIndex,
  readOnly,
  approvedChildFgIds,
}: {
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  header: HeaderDraft;
  components: Item[];
  itemsById: Map<number, Item>;
  weightUnit: UnitRow | null;
  formId?: string;
  onAddLine: () => void;
  focusLineIndex?: number | null;
  readOnly?: boolean;
  approvedChildFgIds: Set<number>;
}) {
  const nums = headerNums(header);
  const totalMix = lines.reduce((sum, l) => sum + (l.mixPercent === "" ? 0 : Number(l.mixPercent)), 0);
  const mixValidationMessage =
    lines.length === 0
      ? "Add at least one RM line."
      : Number.isFinite(totalMix) && Math.abs(totalMix - 100) <= 0.001
        ? null
        : `Total composition must equal 100%${Number.isFinite(totalMix) ? ` (${fmt3(totalMix)}% currently)` : ""}.`;
  const lineSelectRefs = React.useRef<(HTMLSelectElement | null)[]>([]);

  React.useEffect(() => {
    if (focusLineIndex == null || focusLineIndex < 0) return;
    const el = lineSelectRefs.current[focusLineIndex];
    if (el) {
      el.focus();
      try {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        /* ignore */
      }
    }
  }, [focusLineIndex, lines.length]);

  return (
    <BomSectionCard
      title="Components"
      tone="grid"
      headAction={
        readOnly ? null : (
          <Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px] font-bold" onClick={onAddLine}>
            <Plus className="mr-0.5 h-3 w-3" aria-hidden />
            Add line
          </Button>
        )
      }
    >
      {mixValidationMessage ? (
        <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
          {mixValidationMessage}
        </div>
      ) : null}
      <div className="max-h-[min(14rem,32vh)] overflow-auto">
        <table className="bom-planning-table">
          <thead className="sticky top-0 z-[1] bg-slate-50/95">
            <tr>
              <th className="bom-col-rm">Component</th>
              <th className="w-[3.25rem]">Type</th>
              <th className="w-[4.5rem]">Code</th>
              <th className="bom-col-qty bom-col-num">Mix %</th>
              <th className="bom-col-qty bom-col-num">RM Weight</th>
              <th className="bom-col-eff bom-col-num">Effective RM</th>
              <th className="bom-col-act" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
              const item = itemsById.get(l.rmItemId);
              const ct = lineComponentType(item);
              const mix = l.mixPercent === "" ? NaN : Number(l.mixPercent);
              const qty =
                Number.isFinite(mix) && nums.fgWeight != null
                  ? bomLineQuantitiesFromMixPercent(nums.fgWeight, weightUnit, mix, nums.processLossPercent, nums.qcLossPercent)
                  : { rmWeightGm: null, internalQtyKg: null, effectiveQtyKg: null };
              const mixErr = mixPercentError(l, false);
            return (
                <tr key={`bom-line-${i}`}>
                  <td className="bom-col-rm">
                  <select
                      ref={(el) => {
                        lineSelectRefs.current[i] = el;
                      }}
                      className={cn(opSelectClass, "w-full font-semibold text-slate-900")}
                    value={l.rmItemId}
                      disabled={readOnly}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLines((p) => p.map((x, j) => (j === i ? { ...x, rmItemId: v } : x)));
                    }}
                  >
                      {components.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.itemName}
                      </option>
                    ))}
                  </select>
                    {item ? (
                      <SfgChildBomHint
                        itemId={l.rmItemId}
                        itemType={item.itemType}
                        approvedChildFgIds={approvedChildFgIds}
                      />
                    ) : null}
                </td>
                  <td>
                    <BomComponentTypeChip type={ct} />
                  </td>
                  <td className="text-[10px] font-bold tabular-nums text-slate-500">
                    {itemDisplayCode(l.rmItemId)}
                  </td>
                  <td className="bom-col-qty text-right">
                  <Input
                    type="number"
                      className={cn(
                        opInputClass,
                        "ml-auto w-full max-w-[5rem] text-right font-bold",
                        mixErr ? "border-red-300 bg-red-50 text-red-900 focus-visible:ring-red-200" : "",
                      )}
                      step="any"
                      inputMode="decimal"
                      value={l.mixPercent === "" ? "" : l.mixPercent}
                      readOnly={readOnly}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                          setLines((p) => p.map((x, j) => (j === i ? { ...x, mixPercent: "" } : x)));
                        return;
                      }
                        const v = Number(raw);
                      setLines((p) =>
                          p.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  mixPercent: Number.isFinite(v) ? v : "",
                                }
                              : x,
                          ),
                      );
                    }}
                  />
                    {mixErr && !readOnly ? (
                      <div className="mt-1 max-w-[5rem] text-[10px] font-medium leading-tight text-red-700">
                        {mixErr}
                      </div>
                    ) : null}
                </td>
                  <td className="bom-col-qty text-right text-[11px] font-extrabold tabular-nums text-slate-900">
                    {Number.isFinite(Number(qty.rmWeightGm)) ? `${fmt3(Number(qty.rmWeightGm))} gm` : "—"}
                </td>
                  <td className="bom-col-eff text-right text-[11px] font-extrabold tabular-nums text-slate-900">
                    {Number.isFinite(Number(qty.effectiveQtyKg)) ? `${fmt3(Number(qty.effectiveQtyKg) * 1000)} gm` : "—"}
                </td>
                  <td className="bom-col-act text-center">
                    {!readOnly && lines.length > 1 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                        className="h-6 w-6 text-slate-400 hover:bg-red-50 hover:text-red-700"
                      aria-label="Remove line"
                      onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                    >
                        <X className="h-3.5 w-3.5" />
                    </Button>
                    ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      {formId ? <span className="sr-only" data-form-hint={formId} /> : null}
    </BomSectionCard>
  );
}

function BomWorkspaceBody({
  formId,
  header,
  setHeader,
  lines,
  setLines,
  fgs,
  components,
  itemsById,
  weightUnits,
  weightUnit,
  fgId,
  setFgId,
  fgLocked,
  fgSelectRef,
  onAddLine,
  focusLineIndex,
  readOnly,
  docNo,
  revisionLabel,
  fgUnit,
  componentSummary,
  approvedChildFgIds,
}: {
  formId: string;
  header: HeaderDraft;
  setHeader: React.Dispatch<React.SetStateAction<HeaderDraft>>;
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  fgs: Item[];
  components: Item[];
  itemsById: Map<number, Item>;
  weightUnits: UnitRow[];
  weightUnit: UnitRow | null;
  fgId?: number;
  setFgId?: (id: number) => void;
  fgLocked?: { name: string; unit: string };
  fgSelectRef?: React.Ref<HTMLSelectElement>;
  onAddLine: () => void;
  focusLineIndex?: number | null;
  readOnly?: boolean;
  docNo?: string | null;
  revisionLabel?: string;
  fgUnit: string;
  componentSummary?: BomComponentSummary;
  approvedChildFgIds: Set<number>;
}) {
  return (
    <div className="bom-vp-workspace min-w-0">
      <div className="bom-vp-left">
        <BomCompactForm
          header={header}
          setHeader={setHeader}
          docNo={docNo}
          revisionLabel={revisionLabel}
          fgUnit={fgUnit}
          fgId={fgId}
          setFgId={setFgId}
          fgs={fgs}
          weightUnits={weightUnits}
          fgLocked={fgLocked}
          fgSelectRef={fgSelectRef}
          readOnly={readOnly}
        />
        <BomRmWorkspaceTable
          lines={lines}
          setLines={setLines}
          header={header}
          components={components}
          itemsById={itemsById}
          weightUnit={weightUnit}
          formId={formId}
          onAddLine={onAddLine}
          focusLineIndex={focusLineIndex}
          readOnly={readOnly}
          approvedChildFgIds={approvedChildFgIds}
        />
      </div>
      <div className="bom-vp-right">
        <BomSummaryPanel
          header={header}
          weightUnit={weightUnit}
          lines={lines}
          fgUnit={fgUnit}
          itemsById={itemsById}
          componentSummary={componentSummary}
        />
      </div>
    </div>
  );
}

function BomRowActionsMenu({
  onEdit,
  onDuplicate,
  onApprove,
  onInactive,
  onDelete,
  canApprove,
  canInactive,
  canDuplicate,
  canDelete,
}: {
  onEdit: () => void;
  onDuplicate: () => void;
  onApprove: () => void;
  onInactive: () => void;
  onDelete: () => void;
  canApprove: boolean;
  canInactive: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  const reposition = React.useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuW = 148;
    const left = Math.min(Math.max(8, r.right - menuW), window.innerWidth - menuW - 8);
    const top = r.bottom + 4;
    setPos({ top, left });
  }, []);

  React.useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const itemClass =
    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[220] min-w-[9.25rem] rounded-md border border-slate-200 bg-white py-0.5 shadow-lg ring-1 ring-slate-900/5"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" role="menuitem" className={cn(itemClass, "text-slate-700")} onClick={() => { setOpen(false); onEdit(); }}>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        Edit
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canDuplicate}
        className={cn(itemClass, "text-slate-700")}
        onClick={() => { setOpen(false); onDuplicate(); }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        Duplicate
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canApprove}
        className={cn(itemClass, "text-emerald-800")}
        onClick={() => { setOpen(false); onApprove(); }}
      >
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        Approve
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canInactive}
        className={cn(itemClass, "text-amber-800")}
        onClick={() => { setOpen(false); onInactive(); }}
      >
        <Ban className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
        Inactive
      </button>
      <div className="my-0.5 border-t border-slate-100" />
      <button
        type="button"
        role="menuitem"
        disabled={!canDelete}
        className={cn(itemClass, "text-red-700 hover:bg-red-50")}
        onClick={() => { setOpen(false); onDelete(); }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Delete
      </button>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
        aria-label="BOM actions"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}

export function BomsPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [items, setItems] = React.useState<Item[]>([]);
  const [units, setUnits] = React.useState<UnitRow[]>([]);
  const [rows, setRows] = React.useState<BomRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [showInactiveRevisions, setShowInactiveRevisions] = React.useState(false);

  const [workspaceMode, setWorkspaceMode] = React.useState<WorkspaceMode>("idle");
  const [editingBomId, setEditingBomId] = React.useState<number | null>(null);
  const [selectedBomId, setSelectedBomId] = React.useState<number | null>(null);
  const [fgId, setFgId] = React.useState(0);
  const [header, setHeader] = React.useState<HeaderDraft>(defaultHeaderDraft);
  const [lines, setLines] = React.useState<LineDraft[]>([newBlankLine(0)]);
  const [dirtyBaseline, setDirtyBaseline] = React.useState("");
  const [confirmDiscard, setConfirmDiscard] = React.useState<null | "new-draft">(null);
  const [focusRmLineIndex, setFocusRmLineIndex] = React.useState<number | null>(null);
  const [adminGate, setAdminGate] = React.useState<{ mode: "edit" | "delete"; bom: BomRow } | null>(null);
  const [adminGatePassword, setAdminGatePassword] = React.useState("");

  const editorSectionRef = React.useRef<HTMLDivElement | null>(null);
  const workspaceFormRef = React.useRef<HTMLFormElement | null>(null);
  const fgSelectRef = React.useRef<HTMLSelectElement | null>(null);
  const adminGatePasswordRef = React.useRef<HTMLInputElement | null>(null);
  useFastEntryForm({ containerRef: workspaceFormRef, initialFocusRef: fgSelectRef });

  React.useEffect(() => {
    if (!adminGate) return;
    const t = window.setTimeout(() => {
      const el = adminGatePasswordRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [adminGate]);

  async function load(): Promise<BomRow[]> {
    const [i, b, u] = await Promise.all([
      apiFetch<Item[]>("/api/items"),
      apiFetch<BomRow[]>("/api/boms"),
      apiFetch<UnitRow[]>("/api/units"),
    ]);
    setItems(i);
    setRows(b);
    setUnits(u);
    const comps = i.filter((x) => x.itemType === "RM" || x.itemType === "SFG" || x.itemType === "CONSUMABLE");
    if (comps.length && lines[0].rmItemId === 0) setLines([newBlankLine(comps[0].id)]);
    return b;
  }

  React.useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fgs = items.filter((x) => x.itemType === "FG");
  const bomHeaderItems = items.filter((x) => x.itemType === "FG" || x.itemType === "SFG");
  const components = items.filter(
    (x) => x.itemType === "RM" || x.itemType === "SFG" || x.itemType === "CONSUMABLE",
  );
  const visibleRows = React.useMemo(
    () =>
      showInactiveRevisions
        ? rows
        : rows.filter((r) => r.status !== "INACTIVE" && r.status !== "ARCHIVED"),
    [rows, showInactiveRevisions],
  );
  const itemsById = React.useMemo(() => new Map(items.map((r) => [r.id, r])), [items]);
  const activeBomRows = React.useMemo(
    () => rows.filter((r) => r.status === "DRAFT" || r.status === "APPROVED"),
    [rows],
  );
  const approvedChildFgIds = React.useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) {
      if (r.status === "APPROVED") s.add(r.fgItemId);
    }
    return s;
  }, [rows]);
  const unitById = React.useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const weightUnits = React.useMemo(() => {
    const prefer = new Set(["gram", "grams", "g", "gm", "kilogram", "kg"]);
    const list = units.filter((u) => {
      const n = String(u.unitName).toLowerCase();
      const c = String(u.unitCode ?? "").toLowerCase();
      return prefer.has(n) || prefer.has(c);
    });
    return list.length ? list : units;
  }, [units]);

  const activeFg = fgs.find((x) => x.id === fgId);
  const editingBom = editingBomId != null ? rows.find((r) => r.id === editingBomId) ?? null : null;
  const viewingBom =
    workspaceMode === "view" && selectedBomId != null ? rows.find((r) => r.id === selectedBomId) ?? null : null;
  const displayBom = editingBom ?? viewingBom;
  const fgWithoutBom = firstFgWithoutBom(fgs, activeBomRows);
  const createFgs = React.useMemo(
    () => bomHeaderItems.filter((f) => !activeBomRows.some((r) => r.fgItemId === f.id)),
    [bomHeaderItems, activeBomRows],
  );
  const workspaceEditable = workspaceMode === "create" || workspaceMode === "edit";
  const isDirty = workspaceEditable && draftSnapshot(fgId, header, lines) !== dirtyBaseline;
  const canSaveDraft =
    workspaceEditable &&
    (workspaceMode === "create"
      ? !activeBomRows.some((r) => r.fgItemId === fgId)
      : editingBom?.status === "DRAFT");

  function focusAdminGatePassword(selectAll = true) {
    requestAnimationFrame(() => {
      const el = adminGatePasswordRef.current;
      if (!el) return;
      el.focus();
      if (selectAll) el.select();
    });
  }

  function loadBomIntoWorkspace(b: BomRow) {
    const nextHeader = headerFromBom(b);
    const nextLines =
      b.lines.length > 0
        ? b.lines.map((l) => lineFromBom(b, l))
        : [newBlankLine(components[0]?.id ?? 0)];
    setFgId(b.fgItemId);
    setHeader(nextHeader);
    setLines(nextLines);
    return { nextHeader, nextLines };
  }

  function resetWorkspaceToIdle() {
    setWorkspaceMode("idle");
    setEditingBomId(null);
    setSelectedBomId(null);
    setFgId(0);
    setHeader(defaultHeaderDraft());
    setLines([newBlankLine(components[0]?.id ?? 0)]);
    setDirtyBaseline("");
    setFocusRmLineIndex(null);
    setError(null);
  }

  function scrollEditorIntoView(focusFg = false) {
    requestAnimationFrame(() => {
      editorSectionRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      if (focusFg) fgSelectRef.current?.focus();
    });
  }

  function setDraftBaseline(nextFgId: number, nextHeader: HeaderDraft, nextLines: LineDraft[]) {
    setDirtyBaseline(draftSnapshot(nextFgId, nextHeader, nextLines));
  }

  function beginCreateNew() {
    if (!createFgs.length) {
      if (rows.length > 0 && activeBomRows.length === 0) {
        setError("Create a new BOM or enable Show inactive revisions to inspect history.");
      } else {
        setError("All FG items already have an active BOM. Edit an existing BOM from the list.");
      }
      return;
    }
    setError(null);
    setWorkspaceMode("create");
    setEditingBomId(null);
    setSelectedBomId(null);
    const nextFg = fgWithoutBom ?? createFgs[0];
    const nextHeader = defaultHeaderDraft();
    const nextLines = [newBlankLine(components[0]?.id ?? 0)];
    if (nextFg) setFgId(nextFg.id);
    setHeader(nextHeader);
    setLines(nextLines);
    setDraftBaseline(nextFg?.id ?? 0, nextHeader, nextLines);
    scrollEditorIntoView(true);
  }

  function beginViewInline(b: BomRow) {
    setError(null);
    setWorkspaceMode("view");
    setEditingBomId(null);
    setSelectedBomId(b.id);
    loadBomIntoWorkspace(b);
    scrollEditorIntoView(false);
  }

  function beginEditInline(b: BomRow) {
    setError(null);
    setWorkspaceMode("edit");
    setEditingBomId(b.id);
    setSelectedBomId(b.id);
    const { nextHeader, nextLines } = loadBomIntoWorkspace(b);
    setDraftBaseline(b.fgItemId, nextHeader, nextLines);
    scrollEditorIntoView(false);
  }

  function openBomFromRow(b: BomRow) {
    if (b.status === "INACTIVE" || b.status === "ARCHIVED" || bomAppearsLocked(b)) beginViewInline(b);
    else beginEditInline(b);
  }

  function duplicateFromBom(b: BomRow) {
    if (!fgWithoutBom) {
      setError("All FG items already have a BOM. Duplicate needs an FG without a recipe.");
      return;
    }
    setError(null);
    setWorkspaceMode("create");
    setEditingBomId(null);
    setSelectedBomId(null);
    const nextHeader = headerFromBom(b);
    const nextLines = b.lines.map((l) => lineFromBom(b, l));
    setFgId(fgWithoutBom.id);
    setHeader(nextHeader);
    setLines(nextLines.length ? nextLines : [newBlankLine(components[0]?.id ?? 0)]);
    setDraftBaseline(fgWithoutBom.id, nextHeader, nextLines);
    scrollEditorIntoView(true);
  }

  function requestNewDraft() {
    if (isDirty) {
      setConfirmDiscard("new-draft");
      return;
    }
    beginCreateNew();
  }

  function addRmLine() {
    if (!workspaceEditable) return;
      setLines((p) => {
      const next = [...p, newBlankLine(components[0]?.id ?? 0)];
      setFocusRmLineIndex(next.length - 1);
      return next;
    });
  }

  const activeComponentSummary = React.useMemo(() => {
    let rmCount = 0;
    let sfgCount = 0;
    let childBomsLinked = 0;
    for (const l of lines) {
      const it = itemsById.get(l.rmItemId);
      const ct = lineComponentType(it);
      if (ct === "SFG") {
        sfgCount += 1;
        if (approvedChildFgIds.has(l.rmItemId)) childBomsLinked += 1;
      } else rmCount += 1;
    }
    return { rmCount, sfgCount, consumableCount: 0, childBomsLinked, sfgWarnings: [] as string[] };
  }, [lines, itemsById, approvedChildFgIds]);

  const workspaceComponentSummary = displayBom?.componentSummary ?? activeComponentSummary;

  function validateHeader(h: HeaderDraft): string | null {
    const nums = headerNums(h);
    if (nums.fgWeight != null) {
      if (!Number.isFinite(nums.fgWeight) || nums.fgWeight <= 0) return "FG weight must be greater than 0";
      if (!nums.fgWeightUnitId) return "Select weight unit when FG weight is set";
    }
    if (!Number.isFinite(nums.outputQty) || nums.outputQty <= 0) return "Output qty must be greater than 0";
    if (!Number.isFinite(nums.processLossPercent) || nums.processLossPercent < 0 || nums.processLossPercent > 100)
      return "Process wastage % must be between 0 and 100";
    if (!Number.isFinite(nums.qcLossPercent) || nums.qcLossPercent < 0 || nums.qcLossPercent > 100)
      return "QC allowance % must be between 0 and 100";
    if (
      nums.suggestedFgPlanningBufferPercent != null &&
      (!Number.isFinite(nums.suggestedFgPlanningBufferPercent) ||
        nums.suggestedFgPlanningBufferPercent < 0 ||
        nums.suggestedFgPlanningBufferPercent > 10)
    ) {
      return "Suggested FG planning buffer % must be between 0 and 10";
    }
    return null;
  }

  function validateBeforeApprove(h: HeaderDraft): string | null {
    const v = validateDraft(lines, h);
    if (v) return v;
    return null;
  }

  function validateDraft(draft: LineDraft[], h: HeaderDraft) {
    const hv = validateHeader(h);
    if (hv) return hv;
    if (!draft.length) return "Add at least one RM line";
    const seen = new Set<number>();
    const mixTotal = draft.reduce((sum, l) => sum + (l.mixPercent === "" ? 0 : Number(l.mixPercent)), 0);
    if (Math.abs(mixTotal - 100) > 0.001) return "Total composition must equal 100%";
    if (!h.effectiveFrom.trim()) return "Effective From is required";
    for (const l of draft) {
      if (!l.rmItemId) return "Select component item for all lines";
      const it = itemsById.get(l.rmItemId);
      if (it?.itemType === "FG") return "Finished goods cannot be BOM components.";
      if (l.rmItemId === fgId) return "BOM cannot include the same item as its own component.";
      if (seen.has(l.rmItemId)) return "Duplicate component item in BOM lines";
      seen.add(l.rmItemId);
      const mixErr = mixPercentError(l);
      if (mixErr) return mixErr;
    }
    return null;
  }

  function bomPayload(h: HeaderDraft, draft: LineDraft[]) {
    const nums = headerNums(h);
    const weightUnit =
      h.fgWeightUnitId === "" ? null : unitById.get(Number(h.fgWeightUnitId)) ?? displayBom?.fgWeightUnit ?? null;
    const fgWeightGm = nums.fgWeight != null && weightUnit ? fgWeightInGrams(nums.fgWeight, (weightUnit.unitCode ?? weightUnit.unitName ?? "").toLowerCase().includes("kg") ? "kilogram" : "gram") : null;
    return {
      fgWeight: nums.fgWeight,
      fgWeightUnitId: nums.fgWeightUnitId,
      outputQty: nums.outputQty,
      processLossPercent: nums.processLossPercent,
      qcLossPercent: nums.qcLossPercent,
      suggestedFgPlanningBufferPercent: nums.suggestedFgPlanningBufferPercent,
      bomType: h.bomType,
      effectiveFrom: h.effectiveFrom.trim() ? h.effectiveFrom.trim() : null,
      remarks: h.remarks.trim() || null,
      lines: draft.map((l) => {
        const mix = l.mixPercent === "" ? 0 : Number(l.mixPercent);
        const qty =
          fgWeightGm != null && Number.isFinite(mix)
            ? bomLineQuantitiesFromMixPercent(nums.fgWeight ?? 0, weightUnit, mix, nums.processLossPercent, nums.qcLossPercent)
            : { internalQtyKg: null };
        return {
          rmItemId: l.rmItemId,
          baseQty: Number(qty.internalQtyKg ?? 0),
          notes: l.notes.trim() || null,
        };
      }),
    };
  }

  async function approveBom(id: number) {
    setError(null);
    const v = validateBeforeApprove(header);
    if (v) {
      setError(v);
      return;
    }
    try {
      const result = await apiFetch<BomRow & { approvalWarnings?: string[] }>(`/api/boms/${id}/approve`, {
        method: "POST",
      });
      await load();
      resetWorkspaceToIdle();
      toast.showSuccess("BOM approved successfully");
      if (result.approvalWarnings?.length) {
        for (const w of result.approvalWarnings) toast.showInfo(w);
      }
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  async function deactivateBom(id: number) {
    if (!window.confirm("Mark this BOM inactive? Production will stop using it.")) return;
    setError(null);
    try {
      await apiFetch(`/api/boms/${id}/deactivate`, { method: "POST" });
      await load();
      if (editingBomId === id || selectedBomId === id) resetWorkspaceToIdle();
      toast.showSuccess("BOM marked inactive");
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  function bomApiError(err: unknown): string {
    if (err instanceof ApiRequestError && err.status === 409) {
      return err.message || "An active BOM already exists for this FG. Edit the existing BOM or mark it inactive first.";
    }
    if (err instanceof ApiRequestError && err.code === "BOM_IN_USE") {
      return "This BOM is already used in operational transactions. Mark it inactive instead.";
    }
    if (err instanceof ApiRequestError && err.code === "ADMIN_PASSWORD_REQUIRED") {
      return err.message || "Admin password is required to edit or delete locked BOM.";
    }
    if (err instanceof ApiRequestError) return err.message;
    if (err instanceof Error) return err.message;
    return "Request failed";
  }

  async function saveDraft(e?: React.FormEvent) {
    e?.preventDefault();
    if (!workspaceEditable) return;
    setError(null);
    const v = validateDraft(lines, header);
    if (v) {
      setError(v);
      return;
    }
    if (workspaceMode === "create" && activeBomRows.some((r) => r.fgItemId === fgId)) {
      setError("An active BOM already exists for this FG. Edit the existing BOM or mark it inactive first.");
      return;
    }
    try {
      if (workspaceMode === "create") {
      await apiFetch("/api/boms", {
        method: "POST",
          body: JSON.stringify({ fgItemId: fgId, ...bomPayload(header, lines) }),
        });
        const refreshed = await load();
        toast.showSuccess("BOM draft saved");
        const created = refreshed.find((r) => r.fgItemId === fgId && r.status === "DRAFT");
        if (created) beginEditInline(created);
        else setDraftBaseline(fgId, header, lines);
        return;
      }
      if (!editingBomId || editingBom?.status !== "DRAFT") return;
      await apiFetch(`/api/boms/${editingBomId}`, {
        method: "PUT",
        body: JSON.stringify(bomPayload(header, lines)),
      });
      const refreshed = await load();
      toast.showSuccess("BOM draft saved");
      const updated = refreshed.find((r) => r.id === editingBomId);
      if (updated) beginEditInline(updated);
      else setDraftBaseline(fgId, header, lines);
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  async function deleteBomRequest(id: number, adminPassword?: string) {
    await apiFetch(`/api/boms/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminPassword ? { adminPassword } : {}),
    });
  }

  function requestDelete(b: BomRow) {
    if (b.status !== "DRAFT") {
      setError("Only draft BOM revisions can be deleted.");
      return;
    }
    if (!window.confirm("Delete this draft BOM revision? This cannot be undone.")) return;
    void (async () => {
      try {
        await deleteBomRequest(b.id);
        await load();
        if (editingBomId === b.id || selectedBomId === b.id) resetWorkspaceToIdle();
        toast.showSuccess("BOM deleted");
      } catch (err) {
        setError(bomApiError(err));
      }
    })();
  }

  function startEdit(b: BomRow) {
    if (bomAppearsLocked(b)) {
      setAdminGate({ mode: "edit", bom: b });
      setAdminGatePassword("");
      return;
    }
    beginEditInline(b);
  }

  function closeAdminGate() {
    setAdminGate(null);
    setAdminGatePassword("");
  }

  function submitAdminGate() {
    if (!adminGate) return;
    const pwd = adminGatePassword.trim();
    if (!pwd) {
      setError("Enter your admin password to continue.");
      focusAdminGatePassword();
      return;
    }
    setError(null);
    if (adminGate.mode === "edit") {
    void (async () => {
      try {
          const newBom = await apiFetch<BomRow>(`/api/boms/${adminGate.bom.id}/revise`, {
            method: "POST",
            body: JSON.stringify({ adminPassword: pwd }),
          });
        closeAdminGate();
        await load();
          beginEditInline(newBom);
          toast.showSuccess(`Draft revision ${newBom.revisionLabel ?? bomRevisionLabel(newBom.revisionNo ?? 2)} created`);
      } catch (err) {
        setError(bomApiError(err));
          if (err instanceof ApiRequestError && (err.status === 401 || err.code === "ADMIN_PASSWORD_REQUIRED")) {
            focusAdminGatePassword();
          }
        }
      })();
      return;
    }
    void (async () => {
      try {
        await deleteBomRequest(adminGate.bom.id, pwd);
        closeAdminGate();
      await load();
        if (editingBomId === adminGate.bom.id || selectedBomId === adminGate.bom.id) resetWorkspaceToIdle();
        toast.showSuccess("BOM deleted");
    } catch (err) {
      setError(bomApiError(err));
        if (err instanceof ApiRequestError && err.status === 401) {
          focusAdminGatePassword();
    }
      }
    })();
  }

  const workspaceWeightUnit =
    header.fgWeightUnitId === ""
      ? null
      : unitById.get(header.fgWeightUnitId) ?? displayBom?.fgWeightUnit ?? null;

  return (
    <>
      <PageContainer className="bom-vp-page -mt-1 mx-auto w-full max-w-[min(80rem,calc(100vw-1.5rem))]">
        <BomPageHeader
          showToolbar={isAdmin}
          saveDisabled={!canSaveDraft}
          addRmDisabled={!workspaceEditable}
          onNewDraft={requestNewDraft}
          onSaveDraft={() => void saveDraft()}
          onAddRm={addRmLine}
        />

        {error ? (
          <div role="alert" className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-800">
            {error}
          </div>
        ) : null}

        <section className="bom-vp-list">
          <div className="bom-op-card-head flex items-center justify-between gap-2">
            <h2 className="bom-op-card-head-title">Saved BOMs ({visibleRows.length})</h2>
            <button
                      type="button"
              className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => setShowInactiveRevisions((v) => !v)}
            >
              <span
                className={cn(
                  "h-3 w-3 rounded border",
                  showInactiveRevisions ? "border-sky-600 bg-sky-600" : "border-slate-300 bg-white",
                )}
              />
              Show inactive revisions
            </button>
                      </div>
          <div className="bom-vp-list-scroll bom-list-table">
            <table className={cn(erpTable.standard, erpTable.queue, "min-w-[640px] w-full text-[11px]")}>
              <thead className="sticky top-0 z-[1] bg-slate-50/95">
                <tr>
                  <th className="w-[7rem] text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    BOM no.
                  </th>
                  <th className="min-w-[9rem] text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    FG item
                  </th>
                  <th className="w-[5rem] text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    Type
                  </th>
                  <th className="w-[6.5rem] text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    FG weight
                  </th>
                  <th className="w-[4.5rem] text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    Process
                  </th>
                  <th className="w-[4rem] text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    QC
                  </th>
                  <th className="w-[4rem] text-right text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    Lines
                  </th>
                  <th className="w-[5.5rem] text-center text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    Status
                  </th>
                  <th className="w-[6.5rem] text-left text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                    Updated
                  </th>
                  {isAdmin ? <th className={cn(erpTable.actionCell, "w-[3.5rem]")} /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 10 : 9} className="py-2 text-center text-[11px] text-slate-500">
                      {rows.length === 0 ? "No saved BOMs yet." : "No visible BOMs. Enable Show inactive revisions to inspect history."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((b) => {
                    const pl = Number(b.processLossPercent ?? 0);
                    const ql = Number(b.qcLossPercent ?? 0);
                    const fw = b.fgWeight != null ? Number(b.fgWeight) : NaN;
                    const wtLabel = b.fgWeightUnit?.unitName ?? "";
                    const fgWt =
                      Number.isFinite(fw) && fw > 0
                        ? `${fmt3(fw)}${wtLabel ? ` ${wtLabel}` : ""}`
                        : "—";
                    const rowSelected = selectedBomId === b.id;
                    const rowClass =
                      b.status === "INACTIVE" || b.status === "ARCHIVED"
                        ? "bg-slate-50/70 text-slate-500"
                        : "";
                      return (
                      <tr
                        key={b.id}
                        className={cn(rowClass, rowSelected && "bg-sky-50/80", isAdmin && "cursor-pointer hover:bg-slate-50/80")}
                        onClick={() => {
                          if (!isAdmin) return;
                          openBomFromRow(b);
                        }}
                      >
                        <td className="font-bold tabular-nums text-[11px] text-slate-800">
                          {bomDisplayRevision(b.docNo ?? `BOM-${b.id}`, b.revisionNo)}
                        </td>
                        <td className="max-w-[10rem] truncate text-[11px] font-semibold text-slate-900">
                              {b.fgItem.itemName}
                            </td>
                        <td className="text-[11px] text-slate-600">{bomTypeLabel(b.bomType)}</td>
                        <td className="text-right tabular-nums text-[12px] text-slate-800">{fgWt}</td>
                        <td className="text-right tabular-nums text-[12px] text-slate-700">{pl > 0 ? `${pl}%` : "—"}</td>
                        <td className="text-right tabular-nums text-[12px] text-slate-700">{ql > 0 ? `${ql}%` : "—"}</td>
                        <td className="text-right tabular-nums text-[12px] font-medium text-slate-900">
                          {b.componentSummary
                            ? `${b.componentSummary.rmCount}R/${b.componentSummary.sfgCount}S`
                            : b.lines.length}
                          </td>
                        <td className="text-center">
                          {b.status === "INACTIVE" ? (
                            <Badge variant="default" className="px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide">
                              Inactive
                            </Badge>
                          ) : b.status === "ARCHIVED" ? (
                            <Badge variant="default" className="px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide">
                              Archived
                            </Badge>
                          ) : b.status === "APPROVED" || bomAppearsLocked(b) ? (
                            <Badge variant="success" className="px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide">
                              Approved
                                </Badge>
                              ) : (
                            <Badge variant="info" className="px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide">
                              Draft
                                </Badge>
                              )}
                        </td>
                        <td className="text-[11px] text-slate-600">{fmtDate(b.updatedAt)}</td>
                        {isAdmin ? (
                          <td className="text-right" onClick={(e) => e.stopPropagation()}>
                            <BomRowActionsMenu
                              onEdit={() => startEdit(b)}
                              onDuplicate={() => duplicateFromBom(b)}
                              onApprove={() => void approveBom(b.id)}
                              onInactive={() => void deactivateBom(b.id)}
                              onDelete={() => requestDelete(b)}
                              canApprove={b.status === "DRAFT"}
                              canInactive={b.status === "APPROVED"}
                              canDuplicate={!!fgWithoutBom}
                              canDelete={b.status === "DRAFT"}
                            />
                            </td>
                          ) : null}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div ref={editorSectionRef} className="bom-vp-editor min-h-0 flex-1">
          {isAdmin ? (
            workspaceMode === "idle" ? (
              <BomEmptyState onCreate={beginCreateNew} disabled={!createFgs.length || !components.length} />
            ) : (
              <form
                ref={workspaceFormRef}
                id="bom-workspace-form"
                onSubmit={(e) => void saveDraft(e)}
                className="flex h-full min-h-0 flex-col"
              >
                <div className="bom-vp-editor-head shrink-0 border-b border-slate-200/80 bg-white px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="bom-cell__label">
                      {workspaceMode === "create" ? "New BOM" : workspaceMode === "view" ? "View BOM" : "Edit BOM"}
                    </p>
                    {displayBom ? (
                      <>
                        <h2 className="truncate text-[13px] font-bold text-slate-900">{displayBom.fgItem.itemName}</h2>
                        <span className="text-[10px] text-slate-500">{displayBom.docNo ?? `BOM-${displayBom.id}`}</span>
                        <Badge
                          variant={workspaceMode === "view" ? "default" : "info"}
                          className="h-6 px-1.5 py-0 text-[9px] font-bold uppercase"
                        >
                          {workspaceMode === "view" ? "View only" : bomStatusLabel(displayBom.status)}
                        </Badge>
                        {workspaceMode === "view" ? (
                                <Button
                            type="button"
                                  size="sm"
                                  variant="outline"
                            className="ml-auto h-7 px-2.5 text-[11px] font-semibold"
                            onClick={() => startEdit(displayBom)}
                                >
                                  Edit
                                </Button>
                        ) : displayBom.status === "DRAFT" ? (
                                <Button
                            type="button"
                                  size="sm"
                            className="ml-auto h-7 bg-emerald-700 px-2.5 text-[11px] font-bold hover:bg-emerald-800"
                            onClick={() => void approveBom(displayBom.id)}
                                >
                            Approve
                                </Button>
                          ) : null}
                      </>
                    ) : (
                      <span className="text-[11px] font-semibold text-slate-700">Select FG and RM lines, then save draft</span>
                    )}
          </div>
          </div>
                <BomWorkspaceBody
                  formId="bom-workspace-form"
                  header={header}
                  setHeader={setHeader}
                  lines={lines}
                  setLines={setLines}
                  fgs={workspaceMode === "create" ? createFgs : bomHeaderItems}
                  components={components}
                  itemsById={itemsById}
                  weightUnits={weightUnits}
                  weightUnit={workspaceWeightUnit}
                  componentSummary={workspaceComponentSummary}
                  approvedChildFgIds={approvedChildFgIds}
                  readOnly={workspaceMode === "view"}
                  fgId={workspaceMode === "create" ? fgId : undefined}
                  setFgId={workspaceMode === "create" ? setFgId : undefined}
                  fgLocked={
                    (workspaceMode === "edit" || workspaceMode === "view") && displayBom
                      ? { name: displayBom.fgItem.itemName, unit: displayBom.fgItem.unit ?? "—" }
                      : undefined
                  }
                  fgSelectRef={fgSelectRef}
                  onAddLine={addRmLine}
                  focusLineIndex={focusRmLineIndex}
                  docNo={displayBom?.docNo}
                  revisionLabel={displayBom?.revisionLabel ?? bomRevisionLabel(displayBom?.revisionNo)}
                  fgUnit={activeFg?.unit ?? displayBom?.fgItem.unit ?? "Nos"}
                />
              </form>
            )
          ) : (
            <p className="px-2 py-3 text-[11px] text-slate-600">View saved BOMs above. Contact admin to create or edit recipes.</p>
          )}
        </div>
      </PageContainer>

      {confirmDiscard ? (
        <ErpModal onClose={() => setConfirmDiscard(null)} aria-labelledby="bom-discard-title">
          <Card className="w-full max-w-md overflow-hidden rounded-xl border-slate-200/90 shadow-xl ring-1 ring-slate-200/60">
            <CardHeader className="space-y-1.5 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 pb-4 pt-5">
              <CardTitle id="bom-discard-title" className="text-base font-semibold text-slate-900">
                Discard unsaved changes?
              </CardTitle>
              <p className="text-sm leading-relaxed text-slate-600">
                You have unsaved BOM changes. Start a new draft anyway?
              </p>
            </CardHeader>
            <CardContent className="flex justify-end gap-2 px-5 pb-5 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDiscard(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setConfirmDiscard(null);
                  beginCreateNew();
                }}
              >
                New draft
              </Button>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}

      {adminGate ? (
        <ErpModal onClose={closeAdminGate} aria-labelledby="bom-admin-gate-title">
          <Card className="w-full max-w-md overflow-hidden rounded-xl border-slate-200/90 shadow-xl ring-1 ring-slate-200/60">
            <CardHeader className="space-y-1.5 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 pb-4 pt-5">
              <CardTitle id="bom-admin-gate-title" className="text-base font-semibold text-slate-900">
                Admin approval required
              </CardTitle>
              <p id="bom-admin-gate-desc" className="text-sm leading-relaxed text-slate-600">
                {adminGate.mode === "edit"
                  ? "This BOM is approved and locked. Enter admin password to edit it."
                  : "This BOM is approved and locked. Enter admin password to delete it."}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5 pt-4">
              <Input
                ref={adminGatePasswordRef}
                type="password"
                className={cn(opInputClass, "h-9")}
                autoComplete="current-password"
                aria-describedby="bom-admin-gate-desc"
                value={adminGatePassword}
                onChange={(e) => setAdminGatePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitAdminGate();
                  }
                }}
              />
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Button type="button" variant="outline" size="sm" className="h-9 min-w-[5rem] px-4 text-sm font-medium" onClick={closeAdminGate}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 min-w-[5rem] px-4 text-sm font-semibold"
                  variant={adminGate.mode === "delete" ? "destructive" : "default"}
                  onClick={submitAdminGate}
                >
                  {adminGate.mode === "delete" ? "Delete" : "Continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </ErpModal>
      ) : null}
    </>
  );
}
