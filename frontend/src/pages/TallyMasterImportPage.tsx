import * as React from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Download, Info } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { apiFetch, getApiUrl, ApiRequestError } from "../services/api";
import { cn } from "../lib/utils";

type DuplicateAction = "SKIP" | "UPDATE_EMPTY_FIELDS_ONLY";
type DefaultItemType = "RM" | "FG";
type ProposedAction = "CREATE" | "SKIP_DUPLICATE" | "UPDATE_EMPTY_FIELDS" | "ERROR";
type PreviewStatus = "OK" | "WARNING" | "ERROR";

type FieldIssue = {
  masterName: string;
  masterType: string;
  field: string;
  actualValue: string | null;
  reason: string;
  message: string;
};

type PreviewRow = {
  entityType: string;
  tallyName: string;
  proposedAction: ProposedAction;
  existingErpId: number | null;
  warnings: string[];
  errors: string[];
  fieldIssues?: FieldIssue[];
  status?: PreviewStatus;
  mapped: Record<string, unknown>;
};

type PreviewSummary = {
  customers: { total: number; create: number; skip: number; update: number; error: number };
  suppliers: { total: number; create: number; skip: number; update: number; error: number };
  items: { total: number; create: number; skip: number; update: number; error: number };
  units: { total: number; create: number; skip: number; update: number; error: number };
};

type ParsedMasterCounts = {
  customers: number;
  suppliers: number;
  items: number;
  units: number;
  stockGroups: number;
  godowns: number;
  voucherTypes: number;
  ledgers?: number;
  stockItems?: number;
  warnings: number;
};

type ParseStats = {
  tallyMessageOpenInRaw: number;
  ledgerOpenInRaw: number;
  stockItemOpenInRaw: number;
  unitOpenInRaw: number;
  stockGroupOpenInRaw?: number;
  godownOpenInRaw?: number;
  voucherTypeOpenInRaw?: number;
  ledgersParsed: number;
  stockItemsParsed: number;
  unitsParsed: number;
  stockGroupsParsed?: number;
  godownsParsed?: number;
  voucherTypesParsed?: number;
  tallyMessageSeen: number;
};

type ApplyResult = {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  results: { entityType: string; tallyName: string; action: string; erpId: number | null; error: string | null; warning: string | null }[];
  warnings: string[];
  correlationId?: string;
  unresolvedCount?: number;
  summaryMessage?: string;
};

type BlockingError = {
  entityType: string;
  tallyName: string;
  proposedAction: string;
  errors: string[];
  fieldIssues?: FieldIssue[];
  message: string;
};

type StateOpt = { id: number; stateName: string; stateCode: string };

type AlertFilter = "all" | "blocking" | "warnings" | "duplicates";

function formatTallyImportError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    const body = e.body && typeof e.body === "object" ? (e.body as { error?: Record<string, unknown> }) : null;
    const err = body?.error && typeof body.error === "object" ? body.error : null;
    const parts: string[] = [];
    const code = (err && typeof err.code === "string" ? err.code : e.code) || null;
    const ledgerName = err && typeof err.ledgerName === "string" ? err.ledgerName : null;
    const field = err && typeof err.field === "string" ? err.field : null;
    const reason = err && typeof err.reason === "string" ? err.reason : null;
    const correlationId = err && typeof err.correlationId === "string" ? err.correlationId : null;
    if (e.message) parts.push(e.message);
    if (code) parts.push(`Code: ${code}`);
    if (ledgerName) parts.push(`Ledger: ${ledgerName}`);
    if (field) parts.push(`Field: ${field}`);
    if (reason && reason !== e.message) parts.push(`Reason: ${reason}`);
    if (correlationId) parts.push(`Correlation ID: ${correlationId}`);
    return parts.join(" · ");
  }
  return e instanceof Error ? e.message : "Import failed.";
}

function parseCommaKeywordList(raw: string): string[] | undefined {
  const parts = String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 64);
  return parts.length ? parts : undefined;
}

function escCsvCell(v: string): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, header: string, lines: string[]) {
  const blob = new Blob([header + lines.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cell(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

function display(v: unknown): string {
  const s = cell(v).trim();
  return s || "—";
}

function rowStatus(r: PreviewRow): PreviewStatus {
  if (r.status === "OK" || r.status === "WARNING" || r.status === "ERROR") return r.status;
  if (r.proposedAction === "ERROR" || r.errors.length) return "ERROR";
  if (r.warnings.length) return "WARNING";
  return "OK";
}

function partyCsvLines(rows: PreviewRow[]): { header: string; lines: string[] } {
  const header =
    "Name,GSTIN,Contact Person,Phone,Email,Address,State,Action,Status,Warning\n";
  const lines = rows.map((r) =>
    [
      escCsvCell(cell(r.mapped?.name) || r.tallyName),
      escCsvCell(cell(r.mapped?.gst) || cell(r.mapped?.gstRaw)),
      escCsvCell(cell(r.mapped?.contact)),
      escCsvCell(cell(r.mapped?.phone)),
      escCsvCell(cell(r.mapped?.email)),
      escCsvCell(cell(r.mapped?.address)),
      escCsvCell(cell(r.mapped?.stateText)),
      escCsvCell(r.proposedAction),
      escCsvCell(rowStatus(r)),
      escCsvCell([...r.warnings, ...r.errors].join("; ")),
    ].join(","),
  );
  return { header, lines };
}

function itemCsvLines(rows: PreviewRow[]): { header: string; lines: string[] } {
  const header = "Name,Unit,HSN,GST %,Stock Group,Item Type,Action,Status,Warning\n";
  const lines = rows.map((r) =>
    [
      escCsvCell(cell(r.mapped?.itemName) || r.tallyName),
      escCsvCell(cell(r.mapped?.baseUnit)),
      escCsvCell(cell(r.mapped?.hsnCode)),
      escCsvCell(cell(r.mapped?.gstRate)),
      escCsvCell(cell(r.mapped?.tallyStockGroup)),
      escCsvCell(cell(r.mapped?.suggestedItemType) || cell(r.mapped?.itemType)),
      escCsvCell(r.proposedAction),
      escCsvCell(rowStatus(r)),
      escCsvCell([...r.warnings, ...r.errors].join("; ")),
    ].join(","),
  );
  return { header, lines };
}

function unitCsvLines(rows: PreviewRow[]): { header: string; lines: string[] } {
  const header = "Name,Code,Action,Status,Warning\n";
  const lines = rows.map((r) =>
    [
      escCsvCell(cell(r.mapped?.unitName) || r.tallyName),
      escCsvCell(cell(r.mapped?.unitCode)),
      escCsvCell(r.proposedAction),
      escCsvCell(rowStatus(r)),
      escCsvCell([...r.warnings, ...r.errors].join("; ")),
    ].join(","),
  );
  return { header, lines };
}

function previewRowsToCsv(rows: PreviewRow[], tab: string): void {
  if (tab === "customers" || tab === "suppliers") {
    const { header, lines } = partyCsvLines(rows);
    downloadCsv(`tally-import-preview-${tab}.csv`, header, lines);
    return;
  }
  if (tab === "items") {
    const { header, lines } = itemCsvLines(rows);
    downloadCsv(`tally-import-preview-${tab}.csv`, header, lines);
    return;
  }
  if (tab === "units") {
    const { header, lines } = unitCsvLines(rows);
    downloadCsv(`tally-import-preview-${tab}.csv`, header, lines);
    return;
  }
}

function applyResultsToCsv(results: ApplyResult["results"]): void {
  const header = "Entity,Tally name,Action,ERP id,Error,Warning\n";
  const lines = results.map((r) =>
    [
      escCsvCell(r.entityType),
      escCsvCell(r.tallyName),
      escCsvCell(r.action),
      escCsvCell(r.erpId != null ? String(r.erpId) : ""),
      escCsvCell(r.error ?? ""),
      escCsvCell(r.warning ?? ""),
    ].join(","),
  );
  downloadCsv("tally-import-apply-results.csv", header, lines);
}

function StatusBadge({ status }: { status: PreviewStatus }) {
  return (
    <span
      className={cn(
        "inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        status === "OK" && "border-emerald-200 bg-emerald-50 text-emerald-900",
        status === "WARNING" && "border-amber-200 bg-amber-50 text-amber-950",
        status === "ERROR" && "border-red-200 bg-red-50 text-red-900",
      )}
    >
      {status}
    </span>
  );
}

export function TallyMasterImportPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [states, setStates] = React.useState<StateOpt[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const [defaultItemType, setDefaultItemType] = React.useState<DefaultItemType>("FG");
  const [fallbackStateId, setFallbackStateId] = React.useState<string>("");
  const [duplicateAction, setDuplicateAction] = React.useState<DuplicateAction>("SKIP");
  const [itemTypeFgKeywordsCsv, setItemTypeFgKeywordsCsv] = React.useState("");
  const [itemTypeRmKeywordsCsv, setItemTypeRmKeywordsCsv] = React.useState("");
  const [previewing, setPreviewing] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [previewToken, setPreviewToken] = React.useState<string | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [infoNotes, setInfoNotes] = React.useState<string[]>([]);
  const [parsedMasterCounts, setParsedMasterCounts] = React.useState<ParsedMasterCounts | null>(null);
  const [summary, setSummary] = React.useState<PreviewSummary | null>(null);
  const [customers, setCustomers] = React.useState<PreviewRow[]>([]);
  const [suppliers, setSuppliers] = React.useState<PreviewRow[]>([]);
  const [items, setItems] = React.useState<PreviewRow[]>([]);
  const [units, setUnits] = React.useState<PreviewRow[]>([]);
  const [parseStats, setParseStats] = React.useState<ParseStats | null>(null);
  const [pipelineId, setPipelineId] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<ApplyResult | null>(null);
  const [itemRowTypes, setItemRowTypes] = React.useState<Record<string, DefaultItemType>>({});
  const [tab, setTab] = React.useState<"customers" | "suppliers" | "items" | "units" | "alerts">("customers");
  const [blockingErrors, setBlockingErrors] = React.useState<BlockingError[]>([]);
  const [alertFilter, setAlertFilter] = React.useState<AlertFilter>("all");
  const [lastCorrelationId, setLastCorrelationId] = React.useState<string | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const rows = await apiFetch<StateOpt[]>("/api/states");
        setStates(rows);
      } catch {
        setStates([]);
      }
    })();
  }, []);

  async function runPreview() {
    if (!file) {
      toast.showError("Choose a Tally XML file first.");
      return;
    }
    setPreviewing(true);
    setPreviewToken(null);
    setSummary(null);
    setCustomers([]);
    setSuppliers([]);
    setItems([]);
    setUnits([]);
    setItemRowTypes({});
    setParseStats(null);
    setPipelineId(null);
    setParsedMasterCounts(null);
    setInfoNotes([]);
    setApplyResult(null);
    setWarnings([]);
    setBlockingErrors([]);
    setLastCorrelationId(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const fgKws = parseCommaKeywordList(itemTypeFgKeywordsCsv);
      const rmKws = parseCommaKeywordList(itemTypeRmKeywordsCsv);
      fd.append(
        "options",
        JSON.stringify({
          defaultItemType,
          duplicateAction,
          fallbackStateId: fallbackStateId ? Number(fallbackStateId) : null,
          ...(fgKws ? { itemTypeFgKeywords: fgKws } : {}),
          ...(rmKws ? { itemTypeRmKeywords: rmKws } : {}),
        }),
      );
      const auth = localStorage.getItem("token");
      const res = await fetch(getApiUrl("/api/admin/tally-import/preview"), {
        method: "POST",
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = data?.error || {};
        const msg = [
          err.message || `Preview failed (${res.status})`,
          err.code ? `Code: ${err.code}` : null,
          err.ledgerName ? `Ledger: ${err.ledgerName}` : null,
          err.field ? `Field: ${err.field}` : null,
          err.reason ? `Reason: ${err.reason}` : null,
          err.correlationId ? `Correlation ID: ${err.correlationId}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (err.correlationId) setLastCorrelationId(String(err.correlationId));
        throw new ApiRequestError(msg, res.status, err.code, { body: data });
      }
      setPreviewToken(data.previewToken);
      if (data.correlationId) setLastCorrelationId(String(data.correlationId));
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setInfoNotes(Array.isArray(data.infoNotes) ? data.infoNotes : []);
      setBlockingErrors(Array.isArray(data.blockingErrors) ? data.blockingErrors : []);
      setParsedMasterCounts(data.parsedMasterCounts ?? null);
      setSummary(data.summary);
      setCustomers(data.customers ?? []);
      setSuppliers(data.suppliers ?? []);
      setItems(data.items ?? []);
      setUnits(data.units ?? []);
      setParseStats(data.parseStats ?? null);
      setPipelineId(data.runtime?.pipelineId ?? null);
      const itemList: PreviewRow[] = data.items ?? [];
      const initTypes: Record<string, DefaultItemType> = {};
      for (const r of itemList) {
        const t = r.mapped?.suggestedItemType;
        initTypes[r.tallyName] = t === "RM" || t === "FG" ? t : defaultItemType;
      }
      setItemRowTypes(initTypes);
      const blockCount = Array.isArray(data.blockingErrors) ? data.blockingErrors.length : 0;
      toast.showSuccess(
        blockCount
          ? `Preview ready with ${blockCount} blocking error(s). Review Alerts — Confirm still imports valid rows and identity backfills.`
          : "Preview ready. Review the tabs, then confirm import.",
      );
    } catch (e) {
      toast.showError(formatTallyImportError(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function runApply() {
    if (!previewToken) {
      toast.showError("Run Preview first.");
      return;
    }
    const ok = window.confirm(
      "Import the rows shown in the preview into the ERP?\n\n" +
        "Valid rows will be processed (creates, empty-field updates, and Tally identity backfills). " +
        "Rows with blocking errors are left unresolved.\n\n" +
        "We recommend creating a database backup first (Masters → Backup & Restore).\n\n" +
        "Vouchers and accounting entries are never imported.",
    );
    if (!ok) return;
    setApplying(true);
    setApplyResult(null);
    try {
      const out = await apiFetch<ApplyResult>("/api/admin/tally-import/apply", {
        method: "POST",
        body: JSON.stringify({ previewToken, confirm: true, itemTypeOverrides: itemRowTypes }),
      });
      setApplyResult(out);
      if (out.correlationId) setLastCorrelationId(out.correlationId);
      const summaryText =
        out.summaryMessage ||
        `Import finished: ${out.created} created, ${out.updated} updated, ${out.skipped} skipped, ${out.failed} failed.`;
      if (out.failed > 0) toast.showError(summaryText);
      else toast.showSuccess(summaryText);
      setPreviewToken(null);
      setItemRowTypes({});
    } catch (e) {
      toast.showError(formatTallyImportError(e));
    } finally {
      setApplying(false);
    }
  }

  function downloadFullPreviewCsv() {
    const sections: string[] = [];
    const cust = partyCsvLines(customers);
    if (cust.lines.length) {
      sections.push("# Customers");
      sections.push(cust.header.trimEnd());
      sections.push(...cust.lines);
      sections.push("");
    }
    const sup = partyCsvLines(suppliers);
    if (sup.lines.length) {
      sections.push("# Suppliers");
      sections.push(sup.header.trimEnd());
      sections.push(...sup.lines);
      sections.push("");
    }
    const it = itemCsvLines(items);
    if (it.lines.length) {
      sections.push("# Items");
      sections.push(it.header.trimEnd());
      sections.push(...it.lines);
      sections.push("");
    }
    const un = unitCsvLines(units);
    if (un.lines.length) {
      sections.push("# Units");
      sections.push(un.header.trimEnd());
      sections.push(...un.lines);
      sections.push("");
    }
    downloadCsv("tally-import-preview-all.csv", "", sections);
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const tabs: { id: typeof tab; label: string; count: number }[] = [
    { id: "customers", label: "Customers", count: customers.length },
    { id: "suppliers", label: "Suppliers", count: suppliers.length },
    { id: "items", label: "Items", count: items.length },
    { id: "units", label: "Units", count: units.length },
    {
      id: "alerts",
      label: "Warnings / errors",
      count: warnings.length + [...customers, ...suppliers, ...items, ...units].reduce((n, r) => n + r.warnings.length + r.errors.length, 0),
    },
  ];

  const activeRows =
    tab === "customers" ? customers : tab === "suppliers" ? suppliers : tab === "items" ? items : tab === "units" ? units : [];

  const allPreviewRows = [...customers, ...suppliers, ...items, ...units];
  const duplicateRows = allPreviewRows.filter((r) => r.proposedAction === "SKIP_DUPLICATE");
  const warningOnlyRows = allPreviewRows.filter((r) => rowStatus(r) === "WARNING");
  const hasSchemaBlockingError = blockingErrors.some((e) => /schema|identity column|prisma generate|migration/i.test(e.message));
  // Confirm stays enabled for row-level ERROR (those rows are left unresolved). Only hard schema blockers disable it.
  const confirmDisabled = applying || !previewToken || hasSchemaBlockingError;

  const counts = parsedMasterCounts;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 md:px-6 md:py-5">
      <PageHeader title="Tally master import" />

      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <div className="flex gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            Only operational masters will be imported. Vouchers and accounting entries are ignored. Sundry Debtors → Customers,
            Sundry Creditors → Suppliers, Stock Items → Items (HSN and GST % on the item only). Create a{" "}
            <strong>database backup</strong> before importing (Masters → Backup & Restore).
          </div>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 py-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileSpreadsheet className="h-4 w-4 text-slate-600" aria-hidden />
            1. Upload & options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Tally XML file</span>
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                className="mt-1 block w-full max-w-md text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? <div className="mt-1 text-xs text-slate-500">Selected: {file.name}</div> : null}
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Default item type</span>
              <NativeSelect
                className="mt-1 w-full"
                value={defaultItemType}
                onChange={(e) => setDefaultItemType(e.target.value as DefaultItemType)}
              >
                <option value="FG">Finished good (FG)</option>
                <option value="RM">Raw material (RM)</option>
              </NativeSelect>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Fallback state (optional)</span>
              <NativeSelect className="mt-1 w-full" value={fallbackStateId} onChange={(e) => setFallbackStateId(e.target.value)}>
                <option value="">— None —</option>
                {states.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.stateName} ({s.stateCode})
                  </option>
                ))}
              </NativeSelect>
              <span className="mt-1 block text-xs text-slate-500">Used when GSTIN/state text cannot be matched (suppliers require a state).</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">If name already exists</span>
              <NativeSelect
                className="mt-1 w-full"
                value={duplicateAction}
                onChange={(e) => setDuplicateAction(e.target.value as DuplicateAction)}
              >
                <option value="SKIP">Skip (recommended)</option>
                <option value="UPDATE_EMPTY_FIELDS_ONLY">Update empty fields only</option>
              </NativeSelect>
            </label>
          </div>
          <label className="mt-1 block text-sm">
            <span className="font-medium text-slate-800">Auto item-type keywords (optional)</span>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                placeholder="FG: comma-separated (defaults: finished goods, fg, …)"
                value={itemTypeFgKeywordsCsv}
                onChange={(e) => setItemTypeFgKeywordsCsv(e.target.value)}
                aria-label="Custom FG classification keywords"
              />
              <input
                type="text"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                placeholder="RM: comma-separated (defaults: raw material, packing, …)"
                value={itemTypeRmKeywordsCsv}
                onChange={(e) => setItemTypeRmKeywordsCsv(e.target.value)}
                aria-label="Custom RM classification keywords"
              />
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void runPreview()} disabled={previewing || !file}>
              {previewing ? "Previewing…" : "Preview import"}
            </Button>
            {summary ? (
              <Button type="button" variant="outline" size="sm" onClick={downloadFullPreviewCsv}>
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Download preview (CSV)
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {summary ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-3">
            <CardTitle className="text-base font-semibold text-slate-900">2. Preview summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 py-4">
            {counts ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                <CountChip label="Customers" value={counts.customers} />
                <CountChip label="Suppliers" value={counts.suppliers} />
                <CountChip label="Items" value={counts.items} />
                <CountChip label="Units" value={counts.units} />
                <CountChip label="Stock Groups" value={counts.stockGroups} muted />
                <CountChip label="Godowns" value={counts.godowns} muted />
                <CountChip label="Voucher Types" value={counts.voucherTypes} muted />
                <CountChip label="Warnings" value={counts.warnings} warn={counts.warnings > 0} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryChip label="Customers" s={summary.customers} />
              <SummaryChip label="Suppliers" s={summary.suppliers} />
              <SummaryChip label="Items" s={summary.items} />
              <SummaryChip label="Units" s={summary.units} />
            </div>
            {infoNotes.length ? (
              <ul className="space-y-1 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                {infoNotes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {parseStats ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-[11px] leading-relaxed text-slate-700">
                <span className="font-sans font-semibold text-slate-800">XML scan: </span>
                LEDGER {parseStats.ledgersParsed} · STOCKITEM {parseStats.stockItemsParsed} · UNIT {parseStats.unitsParsed}
                {parseStats.stockGroupsParsed != null ? ` · STOCKGROUP ${parseStats.stockGroupsParsed}` : ""}
                {parseStats.godownsParsed != null ? ` · GODOWN ${parseStats.godownsParsed}` : ""}
                {parseStats.voucherTypesParsed != null ? ` · VOUCHERTYPE ${parseStats.voucherTypesParsed}` : ""}
                {pipelineId ? (
                  <div className="mt-1 font-sans text-[10px] text-slate-500">
                    Pipeline: <span className="font-mono">{pipelineId}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {warnings.length ? (
              <ul className="list-inside list-disc text-sm text-amber-900">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    tab === t.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
            {tab === "alerts" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", "All"],
                      ["blocking", `Blocking Errors (${blockingErrors.length})`],
                      ["warnings", `Warnings (${warningOnlyRows.length})`],
                      ["duplicates", `Duplicates (${duplicateRows.length})`],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setAlertFilter(id)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium",
                        alertFilter === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="max-h-72 space-y-2 overflow-auto text-sm" data-testid="tally-import-alerts">
                  {alertFilter === "all" || alertFilter === "warnings"
                    ? infoNotes.map((n) => (
                        <div key={`info-${n}`} className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-950">
                          {n}
                        </div>
                      ))
                    : null}
                  {alertFilter === "all" || alertFilter === "warnings"
                    ? warnings.map((w) => (
                        <div key={w} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">
                          {w}
                        </div>
                      ))
                    : null}
                  {alertFilter === "blocking" || alertFilter === "all"
                    ? blockingErrors.map((be, i) => (
                        <div
                          key={`block-${be.entityType}-${be.tallyName}-${i}`}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-900"
                          data-testid="tally-import-blocking-error"
                        >
                          <span className="font-semibold">{be.entityType}</span> · {be.message}
                        </div>
                      ))
                    : null}
                  {alertFilter === "duplicates"
                    ? duplicateRows.map((r) => (
                        <div
                          key={`dup-${r.entityType}-${r.tallyName}`}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-800"
                        >
                          {r.entityType} &quot;{r.tallyName}&quot; — SKIP_DUPLICATE
                          {r.warnings[0] ? ` · ${r.warnings[0]}` : ""}
                        </div>
                      ))
                    : null}
                  {alertFilter === "all" || alertFilter === "warnings"
                    ? allPreviewRows.flatMap((r) => {
                        if (rowStatus(r) === "ERROR") return [];
                        const issues = r.fieldIssues?.length
                          ? r.fieldIssues
                              .filter((fi) => !r.errors.includes(fi.message))
                              .map((fi) => ({ r, x: fi.message, kind: "w" as const }))
                          : r.warnings.map((x) => ({ r, x, kind: "w" as const }));
                        return issues.map(({ r: row, x, kind }, i) => (
                          <div
                            key={`${row.entityType}-${row.tallyName}-${kind}-${i}`}
                            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-800"
                          >
                            {x}
                          </div>
                        ));
                      })
                    : null}
                  {alertFilter === "all"
                    ? allPreviewRows
                        .filter((r) => rowStatus(r) === "ERROR")
                        .flatMap((r) =>
                          (r.fieldIssues?.length ? r.fieldIssues.map((fi) => fi.message) : r.errors).map((x, i) => (
                            <div
                              key={`err-${r.entityType}-${r.tallyName}-${i}`}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-900"
                            >
                              {x}
                            </div>
                          )),
                        )
                    : null}
                </div>
              </div>
            ) : tab === "items" ? (
              <ItemsPreviewTable
                items={items}
                itemRowTypes={itemRowTypes}
                setItemRowTypes={setItemRowTypes}
                defaultItemType={defaultItemType}
              />
            ) : tab === "units" ? (
              <UnitsPreviewTable rows={units} />
            ) : (
              <PartyPreviewTable rows={activeRows} />
            )}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                type="button"
                onClick={() => void runApply()}
                disabled={confirmDisabled}
                className="bg-emerald-700 hover:bg-emerald-800"
                data-testid="tally-import-confirm-btn"
              >
                {applying ? "Importing…" : "Confirm import"}
              </Button>
              {blockingErrors.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="tally-import-view-blocking-btn"
                  onClick={() => {
                    setTab("alerts");
                    setAlertFilter("blocking");
                  }}
                >
                  View blocking error{blockingErrors.length === 1 ? "" : "s"} ({blockingErrors.length})
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewRowsToCsv(activeRows, tab)}
                disabled={tab === "alerts" || activeRows.length === 0}
              >
                Tab CSV
              </Button>
              {hasSchemaBlockingError ? (
                <p className="w-full text-xs text-red-800">
                  Confirm is disabled until Tally identity columns are available (apply migration + prisma generate).
                </p>
              ) : blockingErrors.length > 0 ? (
                <p className="w-full text-xs text-amber-900">
                  {blockingErrors.length} blocking row(s) will be left unresolved. SKIP_DUPLICATE rows are warnings and still receive
                  identity backfill. Confirm imports all valid rows.
                </p>
              ) : null}
              {lastCorrelationId ? (
                <p className="w-full font-mono text-[10px] text-slate-500">Last correlation ID: {lastCorrelationId}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {applyResult ? (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 py-3">
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden />
              3. Import result
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 py-4 text-sm">
            <p>
              Created: <strong>{applyResult.created}</strong> · Updated: <strong>{applyResult.updated}</strong> · Skipped:{" "}
              <strong>{applyResult.skipped}</strong> · Failed: <strong>{applyResult.failed}</strong>
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => applyResultsToCsv(applyResult.results)}>
              <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Download result report (CSV)
            </Button>
            {applyResult.failed > 0 ? (
              <div className="max-h-48 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-xs text-red-900">
                {applyResult.results
                  .filter((r) => r.action === "FAILED")
                  .map((r) => (
                    <div key={`${r.entityType}-${r.tallyName}-fail`}>
                      {r.entityType} · {r.tallyName}: {r.error}
                    </div>
                  ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200 bg-slate-50 shadow-sm">
        <CardContent className="py-3 text-xs text-slate-600">
          <strong className="text-slate-800">How to export from Tally:</strong> In Tally Prime, use{" "}
          <span className="font-mono">Gateway of Tally → Import/Export → Export</span> (or your company’s XML export path) and export{" "}
          <strong>masters</strong> (ledgers, stock items, units) as XML. Do not rely on transaction/voucher XML for this screen. If the file
          contains voucher sections, they are ignored and you will see a notice. Preview shows all fields that will be imported; Stock Groups,
          Godowns and Voucher Types may appear as parsed counts only in Release-1.
        </CardContent>
      </Card>
    </div>
  );
}

function CountChip({
  label,
  value,
  muted,
  warn,
}: {
  label: string;
  value: number;
  muted?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-2 py-2 text-xs",
        warn ? "border-amber-200 bg-amber-50" : muted ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white",
      )}
    >
      <div className="font-semibold text-slate-800">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function SummaryChip({ label, s }: { label: string; s: { create: number; skip: number; update: number; error: number; total: number } }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs">
      <div className="font-semibold text-slate-800">{label}</div>
      <div className="mt-1 text-slate-600">
        New {s.create} · Skip {s.skip} · Update {s.update} · Error {s.error}{" "}
        <span className="text-slate-400">(total {s.total})</span>
      </div>
    </div>
  );
}

function PartyPreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded border border-slate-200">
      <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-[1] bg-slate-100 text-slate-700">
          <tr>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Name</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">GSTIN</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Contact Person</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Phone</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Email</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Address</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">State</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Action</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gst = display(r.mapped?.gstin || r.mapped?.gst || r.mapped?.gstRaw);
            const notes = [...r.warnings, ...r.errors].join(" · ");
            return (
              <tr key={`${r.entityType}-${r.tallyName}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80">
                <td className="px-2 py-1 align-top font-medium text-slate-900">{display(r.mapped?.name) || r.tallyName}</td>
                <td className="px-2 py-1 align-top font-mono text-[11px] text-slate-800" title={notes || undefined}>
                  {gst}
                </td>
                <td className="max-w-[120px] truncate px-2 py-1 align-top text-slate-800">
                  {display(r.mapped?.contactPerson || r.mapped?.contact)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 align-top text-slate-800">{display(r.mapped?.phone)}</td>
                <td className="max-w-[140px] truncate px-2 py-1 align-top text-slate-800">{display(r.mapped?.email)}</td>
                <td className="max-w-[180px] truncate px-2 py-1 align-top text-slate-700" title={cell(r.mapped?.address) || undefined}>
                  {display(r.mapped?.address)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 align-top text-slate-800">{display(r.mapped?.stateText)}</td>
                <td className="whitespace-nowrap px-2 py-1 align-top">{r.proposedAction}</td>
                <td className="px-2 py-1 align-top" title={notes || undefined}>
                  <StatusBadge status={rowStatus(r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnitsPreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded border border-slate-200">
      <table className="w-full min-w-[640px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-[1] bg-slate-100 text-slate-700">
          <tr>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Name</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Code</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Action</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`UNIT-${r.tallyName}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80">
              <td className="px-2 py-1 align-top font-medium text-slate-900">{display(r.mapped?.unitName) || r.tallyName}</td>
              <td className="px-2 py-1 align-top font-mono text-[11px] text-slate-800">{display(r.mapped?.unitCode)}</td>
              <td className="whitespace-nowrap px-2 py-1 align-top">{r.proposedAction}</td>
              <td className="px-2 py-1 align-top">
                <StatusBadge status={rowStatus(r)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemsPreviewTable({
  items,
  itemRowTypes,
  setItemRowTypes,
  defaultItemType,
}: {
  items: PreviewRow[];
  itemRowTypes: Record<string, DefaultItemType>;
  setItemRowTypes: React.Dispatch<React.SetStateAction<Record<string, DefaultItemType>>>;
  defaultItemType: DefaultItemType;
}) {
  return (
    <div className="max-h-80 overflow-auto rounded border border-slate-200">
      <table className="w-full min-w-[960px] border-collapse text-left text-xs">
        <thead className="sticky top-0 z-[1] bg-slate-100 text-slate-700">
          <tr>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Name</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Unit</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">HSN</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">GST %</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Tally stock group</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Auto</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Item type</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Action</th>
            <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const unit = display(r.mapped?.baseUnit);
            const hsn = display(r.mapped?.hsnCode);
            const gstRaw = r.mapped?.gstRate;
            const gst =
              gstRaw != null && gstRaw !== "" && Number.isFinite(Number(gstRaw)) ? String(Number(gstRaw)) : "—";
            const stockGroup = display(r.mapped?.tallyStockGroup);
            const auto = r.mapped?.autoDetectedItemType;
            const rowType =
              itemRowTypes[r.tallyName] ??
              (r.mapped?.suggestedItemType === "RM" || r.mapped?.suggestedItemType === "FG"
                ? r.mapped.suggestedItemType
                : defaultItemType);
            const notes = [...r.warnings, ...r.errors].join(" · ");
            return (
              <tr key={`ITEM-${r.tallyName}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80">
                <td className="px-2 py-1 align-top font-medium text-slate-900">{r.tallyName}</td>
                <td className="max-w-[100px] truncate px-2 py-1 align-top text-slate-800" title={unit}>
                  {unit}
                </td>
                <td className="px-2 py-1 align-top font-mono text-[11px] text-slate-800">{hsn}</td>
                <td className="px-2 py-1 align-top tabular-nums text-slate-800">{gst}</td>
                <td className="max-w-[140px] truncate px-2 py-1 align-top text-slate-700" title={stockGroup === "—" ? undefined : stockGroup}>
                  {stockGroup}
                </td>
                <td className="whitespace-nowrap px-2 py-1 align-top">
                  {auto === "RM" ? (
                    <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-900">
                      RM
                    </span>
                  ) : auto === "FG" ? (
                    <span className="inline-block rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-900">
                      FG
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-2 py-1 align-top">
                  <NativeSelect
                    className="h-7 max-w-[5.5rem] py-0 pr-6 text-xs"
                    value={rowType}
                    onChange={(e) => {
                      const v = e.target.value as DefaultItemType;
                      setItemRowTypes((prev) => ({ ...prev, [r.tallyName]: v }));
                    }}
                    aria-label={`Item type for ${r.tallyName}`}
                  >
                    <option value="RM">RM</option>
                    <option value="FG">FG</option>
                  </NativeSelect>
                </td>
                <td className="whitespace-nowrap px-2 py-1 align-top">{r.proposedAction}</td>
                <td className="px-2 py-1 align-top" title={notes || undefined}>
                  <StatusBadge status={rowStatus(r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
