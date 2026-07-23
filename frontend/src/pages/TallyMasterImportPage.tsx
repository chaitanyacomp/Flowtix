import * as React from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Download, Info, Loader2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { apiFetch, getApiUrl, ApiRequestError } from "../services/api";
import { cn } from "../lib/utils";
import {
  buildAnalysingView,
  buildFailedView,
  buildImportingView,
  buildPreparingPreviewView,
  buildPreviewReadyView,
  buildUploadingView,
  estimateRemainingMs,
  formatElapsed,
  isProgressStalled,
  mapUploadPercent,
  newClientOperationId,
  releaseBusy,
  stage1InputsLocked,
  stage2MappingEditable,
  startOverAllowed,
  tryAcquireBusy,
  type EtaRateSample,
  type TallyImportProgressView,
} from "../lib/tallyMasterImportProgress";
import { xhrFormDataUpload } from "../lib/tallyMasterImportUpload";
import { buildTallyConfirmImportBody, formatTallyConfirm413Message } from "../lib/tallyMasterImportConfirm";

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
  partyRows?: {
    totalRowsDetected: number;
    eligibleCustomers: number;
    eligibleSuppliers: number;
    excludedParentGroup: number;
    duplicates: number;
    invalidRows: number;
  };
  stockPreview?: {
    encoding?: string | null;
    totalStockItems: number;
    sanitizedInvalidRefCount: number;
    importable: number;
    excluded: number;
    duplicates: number;
    conflicts: number;
    blankGroups: number;
    unresolvedUnits: number;
    unresolvedGst: number;
    openingBalanceNotPosted?: boolean;
  };
};

type GroupMappingRow = {
  groupKey: string;
  tallyGroup: string;
  detectedCount: number;
  suggested: string;
  choice: string;
  erpItemType: string | null;
  importAction: string;
  note: string;
};

type UnitMappingRow = {
  aliasKey: string;
  sourceUnit: string;
  detectedCount: number;
  suggestedErpUnitName: string | null;
  proposedErpUnitName: string | null;
  proposedErpUnitId: number | null;
  unresolved: boolean;
  importAction: string;
};

type DecodeMeta = {
  encoding: string;
  sanitizedInvalidRefCount: number;
  byteLength: number;
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
  totalPartyRowsDetected?: number;
  excludedParentGroup?: number;
  partyDuplicates?: number;
  partyInvalidRows?: number;
};

type ParseStats = {
  tallyMessageOpenInRaw: number;
  ledgerOpenInRaw: number;
  stockItemOpenInRaw: number;
  unitOpenInRaw: number;
  stockGroupOpenInRaw?: number;
  godownOpenInRaw?: number;
  voucherTypeOpenInRaw?: number;
  caAcctTypeNameOpenInRaw?: number;
  customFlatRowsDetected?: number;
  customFlatLedgersBuilt?: number;
  customFlatInvalidRows?: number;
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
    if (e.status === 413 || e.code === "CONFIRM_PAYLOAD_TOO_LARGE" || /entity too large/i.test(e.message)) {
      return formatTallyConfirm413Message();
    }
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
  const [groupMapping, setGroupMapping] = React.useState<GroupMappingRow[]>([]);
  const [unitMapping, setUnitMapping] = React.useState<UnitMappingRow[]>([]);
  const [groupTypeOverrides, setGroupTypeOverrides] = React.useState<Record<string, string>>({});
  const [unitMapOverrides, setUnitMapOverrides] = React.useState<Record<string, string>>({});
  const [decodeMeta, setDecodeMeta] = React.useState<DecodeMeta | null>(null);
  const [wizardStage, setWizardStage] = React.useState<1 | 2>(1);
  /** After successful preview, Stage 1 file/options stay locked until Start over. */
  const [previewLocked, setPreviewLocked] = React.useState(false);
  const [progressView, setProgressView] = React.useState<TallyImportProgressView | null>(null);
  const [selectedFilename, setSelectedFilename] = React.useState<string>("");

  const busyRef = React.useRef(false);
  const previewRequestIdRef = React.useRef(0);
  const applyRequestIdRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const pollTimerRef = React.useRef<number | null>(null);
  const elapsedTimerRef = React.useRef<number | null>(null);
  const progressStartedAtRef = React.useRef<number>(0);
  const lastProgressAtRef = React.useRef<number>(0);
  const lastProcessedRef = React.useRef<number>(0);
  const etaSampleRef = React.useRef<EtaRateSample | null>(null);
  const latestOpRef = React.useRef<Record<string, unknown> | null>(null);
  const progressModeRef = React.useRef<"preview" | "apply" | null>(null);
  const progressFilenameRef = React.useRef<string>("");
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const busy = previewing || applying;
  const stage1Locked = stage1InputsLocked(busy, previewLocked);
  const stage2Editable = stage2MappingEditable(Boolean(summary && previewToken), busy);

  React.useEffect(() => {
    void (async () => {
      try {
        const rows = await apiFetch<StateOpt[]>("/api/states");
        setStates(rows);
      } catch {
        setStates([]);
      }
    })();
    return () => {
      if (pollTimerRef.current != null) window.clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current != null) window.clearInterval(elapsedTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function stopPolling() {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function stopElapsedTicker() {
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  function refreshProgressFromLatestOp() {
    const mode = progressModeRef.current;
    const filename = progressFilenameRef.current;
    if (!mode || !filename) return;
    const elapsed = Date.now() - progressStartedAtRef.current;
    const op = latestOpRef.current;
    if (mode === "apply") {
      setProgressView(
        buildImportingView(filename, {
          elapsedMs: elapsed,
          batchIndex: typeof op?.batchIndex === "number" ? op.batchIndex : null,
          batchTotal: typeof op?.batchTotal === "number" ? op.batchTotal : null,
          itemsProcessed: typeof op?.recordsProcessed === "number" ? op.recordsProcessed : null,
          itemsTotal: typeof op?.recordsDetected === "number" ? op.recordsDetected : null,
        }),
      );
      return;
    }
    if (op?.phase === "preparing_preview") {
      setProgressView(buildPreparingPreviewView(filename, elapsed));
      return;
    }
    if (op?.phase === "preview_ready" || op?.status === "completed") {
      setProgressView(buildPreviewReadyView(filename, elapsed));
      return;
    }
    const processed =
      typeof op?.stockItemsProcessed === "number"
        ? op.stockItemsProcessed
        : typeof op?.recordsProcessed === "number"
          ? op.recordsProcessed
          : null;
    const total =
      typeof op?.stockItemsTotal === "number"
        ? op.stockItemsTotal
        : typeof op?.recordsDetected === "number"
          ? op.recordsDetected
          : null;
    if (processed != null && processed !== lastProcessedRef.current) {
      lastProcessedRef.current = processed;
      lastProgressAtRef.current = Date.now();
    }
    const eta = estimateRemainingMs({
      processed: processed ?? 0,
      total: total ?? 0,
      elapsedMs: elapsed,
      previous: etaSampleRef.current,
    });
    if (processed != null && processed > 0) {
      etaSampleRef.current = { processed, atMs: elapsed };
    }
    const stalled = isProgressStalled({
      lastProgressAtMs: lastProgressAtRef.current || progressStartedAtRef.current,
      nowMs: Date.now(),
    });
    setProgressView(
      buildAnalysingView(filename, {
        recordsHint: total,
        processed,
        total,
        serverPercent: typeof op?.percent === "number" ? op.percent : null,
        elapsedMs: elapsed,
        etaLabel: eta.label,
        stalled,
      }),
    );
  }

  function startElapsedTicker() {
    stopElapsedTicker();
    elapsedTimerRef.current = window.setInterval(() => {
      refreshProgressFromLatestOp();
    }, 1000);
  }

  function startOperationPolling(operationId: string, mode: "preview" | "apply", filename: string) {
    stopPolling();
    progressModeRef.current = mode;
    progressFilenameRef.current = filename;
    lastProgressAtRef.current = Date.now();
    lastProcessedRef.current = 0;
    etaSampleRef.current = null;
    startElapsedTicker();
    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const auth = localStorage.getItem("token");
          const res = await fetch(getApiUrl(`/api/admin/tally-import/operations/${encodeURIComponent(operationId)}`), {
            headers: auth ? { Authorization: `Bearer ${auth}` } : {},
          });
          if (!res.ok) return;
          const op = (await res.json()) as Record<string, unknown>;
          latestOpRef.current = op;
          refreshProgressFromLatestOp();
        } catch {
          /* ignore poll errors */
        }
      })();
    }, 500);
  }

  function resetPreviewResults() {
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
    setWarnings([]);
    setBlockingErrors([]);
    setGroupMapping([]);
    setUnitMapping([]);
    setGroupTypeOverrides({});
    setUnitMapOverrides({});
    setDecodeMeta(null);
    setWizardStage(1);
  }

  function startOver() {
    if (!startOverAllowed(busyRef.current || busy)) return;
    abortRef.current?.abort();
    abortRef.current = null;
    stopPolling();
    stopElapsedTicker();
    progressModeRef.current = null;
    latestOpRef.current = null;
    previewRequestIdRef.current += 1;
    applyRequestIdRef.current += 1;
    resetPreviewResults();
    setApplyResult(null);
    setPreviewLocked(false);
    setProgressView(null);
    setLastCorrelationId(null);
    setFile(null);
    setSelectedFilename("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function runPreview() {
    if (!tryAcquireBusy(busyRef)) return;
    if (!file) {
      releaseBusy(busyRef);
      toast.showError("Choose a Tally XML file first.");
      return;
    }
    const filename = file.name;
    setSelectedFilename(filename);
    const requestId = ++previewRequestIdRef.current;
    const operationId = newClientOperationId();
    const ac = new AbortController();
    abortRef.current = ac;
    progressStartedAtRef.current = Date.now();

    setPreviewing(true);
    setApplyResult(null);
    resetPreviewResults();
    setProgressView(buildUploadingView(filename, 0, 0));

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
          clientOperationId: operationId,
          sourceFilename: filename,
          ...(fgKws ? { itemTypeFgKeywords: fgKws } : {}),
          ...(rmKws ? { itemTypeRmKeywords: rmKws } : {}),
        }),
      );
      const auth = localStorage.getItem("token");

      const uploadPromise = xhrFormDataUpload({
        url: getApiUrl("/api/admin/tally-import/preview"),
        formData: fd,
        headers: {
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          "X-Tally-Import-Operation-Id": operationId,
        },
        signal: ac.signal,
        onUploadProgress: (p) => {
          if (previewRequestIdRef.current !== requestId) return;
          const total = p.total || file.size || 0;
          const elapsed = Date.now() - progressStartedAtRef.current;
          if (total > 0 && p.loaded >= total) {
            setProgressView(
              buildAnalysingView(filename, {
                recordsHint: null,
                serverPercent: null,
                elapsedMs: elapsed,
              }),
            );
            return;
          }
          const pct = mapUploadPercent(p.loaded, total);
          setProgressView(buildUploadingView(filename, pct, elapsed));
        },
      });

      // After a short delay (upload typically still going), begin polling server analysis.
      window.setTimeout(() => {
        if (previewRequestIdRef.current === requestId && !ac.signal.aborted) {
          startOperationPolling(operationId, "preview", filename);
        }
      }, 400);

      const res = await uploadPromise;
      stopPolling();
      stopElapsedTicker();
      if (previewRequestIdRef.current !== requestId) return;

      setProgressView(buildPreparingPreviewView(filename, Date.now() - progressStartedAtRef.current));
      const data = (res.json && typeof res.json === "object" ? res.json : {}) as Record<string, unknown>;
      if (!res.ok) {
        const err = (data.error && typeof data.error === "object" ? data.error : {}) as Record<string, unknown>;
        const msg = [
          (typeof err.message === "string" && err.message) || `Preview failed (${res.status})`,
          typeof err.code === "string" ? `Code: ${err.code}` : null,
          typeof err.ledgerName === "string" ? `Ledger: ${err.ledgerName}` : null,
          typeof err.field === "string" ? `Field: ${err.field}` : null,
          typeof err.reason === "string" ? `Reason: ${err.reason}` : null,
          typeof err.correlationId === "string" ? `Correlation ID: ${err.correlationId}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (typeof err.correlationId === "string") setLastCorrelationId(err.correlationId);
        setProgressView(
          buildFailedView(filename, "Preview failed", msg, Date.now() - progressStartedAtRef.current),
        );
        throw new ApiRequestError(msg, res.status, typeof err.code === "string" ? err.code : undefined, { body: data });
      }

      if (previewRequestIdRef.current !== requestId) return;

      setPreviewToken(typeof data.previewToken === "string" ? data.previewToken : null);
      if (typeof data.correlationId === "string") setLastCorrelationId(data.correlationId);
      setWarnings(Array.isArray(data.warnings) ? (data.warnings as string[]) : []);
      setInfoNotes(Array.isArray(data.infoNotes) ? (data.infoNotes as string[]) : []);
      setBlockingErrors(Array.isArray(data.blockingErrors) ? (data.blockingErrors as BlockingError[]) : []);
      setParsedMasterCounts((data.parsedMasterCounts as ParsedMasterCounts) ?? null);
      setSummary((data.summary as PreviewSummary) ?? null);
      setCustomers((data.customers as PreviewRow[]) ?? []);
      setSuppliers((data.suppliers as PreviewRow[]) ?? []);
      setItems((data.items as PreviewRow[]) ?? []);
      setUnits((data.units as PreviewRow[]) ?? []);
      setParseStats((data.parseStats as ParseStats) ?? null);
      const runtime = data.runtime as { pipelineId?: string } | undefined;
      setPipelineId(runtime?.pipelineId ?? null);
      setGroupMapping(Array.isArray(data.groupMapping) ? (data.groupMapping as GroupMappingRow[]) : []);
      setUnitMapping(Array.isArray(data.unitMapping) ? (data.unitMapping as UnitMappingRow[]) : []);
      setDecodeMeta((data.decode as DecodeMeta) ?? null);
      setWizardStage(2);
      setPreviewLocked(true);
      const gInit: Record<string, string> = {};
      for (const g of (data.groupMapping as GroupMappingRow[]) ?? []) {
        if (g?.groupKey) gInit[g.groupKey] = g.choice || g.suggested || "EXCLUDE";
      }
      setGroupTypeOverrides(gInit);
      const uInit: Record<string, string> = {};
      for (const u of (data.unitMapping as UnitMappingRow[]) ?? []) {
        if (u?.aliasKey && u.proposedErpUnitName) uInit[u.aliasKey] = u.proposedErpUnitName;
      }
      setUnitMapOverrides(uInit);
      const itemList: PreviewRow[] = (data.items as PreviewRow[]) ?? [];
      const initTypes: Record<string, DefaultItemType> = {};
      for (const r of itemList) {
        const t = r.mapped?.suggestedItemType;
        initTypes[r.tallyName] = t === "RM" || t === "FG" ? t : defaultItemType;
      }
      setItemRowTypes(initTypes);
      setProgressView(buildPreviewReadyView(filename, Date.now() - progressStartedAtRef.current));
      const blockCount = Array.isArray(data.blockingErrors) ? data.blockingErrors.length : 0;
      toast.showSuccess(
        blockCount
          ? `Stage 2 ready with ${blockCount} blocking error(s). Review mappings — Confirm still imports valid rows.`
          : "Stage 2: review group/unit mappings, then confirm import.",
      );
      window.setTimeout(() => {
        if (previewRequestIdRef.current === requestId) setProgressView(null);
      }, 800);
    } catch (e) {
      stopPolling();
      stopElapsedTicker();
      if (previewRequestIdRef.current !== requestId) return;
      if ((e as Error)?.name === "AbortError") return;
      toast.showError(formatTallyImportError(e));
      setPreviewLocked(false);
    } finally {
      stopPolling();
      stopElapsedTicker();
      progressModeRef.current = null;
      if (previewRequestIdRef.current === requestId) {
        setPreviewing(false);
        releaseBusy(busyRef);
      }
    }
  }

  async function runApply() {
    if (!tryAcquireBusy(busyRef)) return;
    if (!previewToken) {
      releaseBusy(busyRef);
      toast.showError("Run Preview first.");
      return;
    }
    // Lock Stage 2 immediately (sync ref + React state) before confirm dialog / API.
    setApplying(true);
    const ok = window.confirm(
      "Import the rows shown in the preview into the ERP?\n\n" +
        "Valid rows will be processed (creates, empty-field updates, and Tally identity backfills). " +
        "Rows with blocking errors are left unresolved.\n\n" +
        "We recommend creating a database backup first (Masters → Backup & Restore).\n\n" +
        "Vouchers and accounting entries are never imported.",
    );
    if (!ok) {
      setApplying(false);
      releaseBusy(busyRef);
      return;
    }

    const requestId = ++applyRequestIdRef.current;
    const operationId = newClientOperationId();
    const filename = selectedFilename || file?.name || "Tally XML";
    progressStartedAtRef.current = Date.now();
    setApplyResult(null);
    setProgressView(
      buildImportingView(filename, {
        elapsedMs: 0,
        batchIndex: null,
        batchTotal: null,
        itemsProcessed: null,
        itemsTotal: summary?.stockPreview?.totalStockItems ?? items.length,
      }),
    );
    startOperationPolling(operationId, "apply", filename);

    try {
      const confirmBody = buildTallyConfirmImportBody({
        previewToken,
        clientOperationId: operationId,
        groupTypeOverrides,
        unitMapOverrides,
        duplicateAction,
      });
      const out = await apiFetch<ApplyResult & { operationId?: string; itemBatching?: { batchesTotal?: number } }>(
        "/api/admin/tally-import/apply",
        {
          method: "POST",
          body: JSON.stringify(confirmBody),
          headers: { "X-Tally-Import-Operation-Id": operationId },
        },
      );
      stopPolling();
      stopElapsedTicker();
      if (applyRequestIdRef.current !== requestId) return;
      setApplyResult(out);
      if (out.correlationId) setLastCorrelationId(out.correlationId);
      const summaryText =
        out.summaryMessage ||
        `Import finished: ${out.created} created, ${out.updated} updated, ${out.skipped} skipped, ${out.failed} failed.`;
      if (out.failed > 0) toast.showError(summaryText);
      else toast.showSuccess(summaryText);
      // Consume token only after successful response; keep Stage-2 mappings visible for review.
      setPreviewToken(null);
      setProgressView(null);
    } catch (e) {
      stopPolling();
      stopElapsedTicker();
      if (applyRequestIdRef.current !== requestId) return;
      // Keep previewToken + mappings so Confirm can be retried without re-upload.
      toast.showError(formatTallyImportError(e));
      setProgressView(
        buildFailedView(filename, "Import failed", formatTallyImportError(e), Date.now() - progressStartedAtRef.current),
      );
    } finally {
      stopPolling();
      stopElapsedTicker();
      progressModeRef.current = null;
      if (applyRequestIdRef.current === requestId) {
        setApplying(false);
        releaseBusy(busyRef);
      }
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
  const confirmDisabled = busy || !previewToken || hasSchemaBlockingError || !stage2Editable;

  const counts = parsedMasterCounts;

  return (
    <div className="relative mx-auto w-full max-w-6xl space-y-4 px-4 py-4 md:px-6 md:py-5" data-testid="tally-import-page">
      {progressView && (busy || progressView.phase === "failed" || progressView.phase === "preview_ready") ? (
        <TallyImportProgressOverlay view={progressView} blocking={busy} />
      ) : null}

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
                ref={fileInputRef}
                type="file"
                accept=".xml,text/xml,application/xml"
                data-testid="tally-import-file-input"
                disabled={stage1Locked}
                className="mt-1 block w-full max-w-md text-xs text-slate-700 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 disabled:cursor-not-allowed disabled:opacity-60"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setSelectedFilename(f?.name || "");
                }}
              />
              {selectedFilename || file ? (
                <div className="mt-1 text-xs text-slate-500" data-testid="tally-import-selected-filename">
                  Selected: {selectedFilename || file?.name}
                  {previewLocked ? " (locked until Start over)" : null}
                </div>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Default item type</span>
              <NativeSelect
                className="mt-1 w-full"
                value={defaultItemType}
                disabled={stage1Locked}
                data-testid="tally-import-default-item-type"
                onChange={(e) => setDefaultItemType(e.target.value as DefaultItemType)}
              >
                <option value="FG">Finished good (FG)</option>
                <option value="RM">Raw material (RM)</option>
              </NativeSelect>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Fallback state (optional)</span>
              <NativeSelect
                className="mt-1 w-full"
                value={fallbackStateId}
                disabled={stage1Locked}
                data-testid="tally-import-fallback-state"
                onChange={(e) => setFallbackStateId(e.target.value)}
              >
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
                disabled={stage1Locked}
                data-testid="tally-import-duplicate-action"
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
                disabled={stage1Locked}
                data-testid="tally-import-fg-keywords"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="FG: comma-separated (defaults: finished goods, fg, …)"
                value={itemTypeFgKeywordsCsv}
                onChange={(e) => setItemTypeFgKeywordsCsv(e.target.value)}
                aria-label="Custom FG classification keywords"
              />
              <input
                type="text"
                disabled={stage1Locked}
                data-testid="tally-import-rm-keywords"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="RM: comma-separated (defaults: raw material, packing, …)"
                value={itemTypeRmKeywordsCsv}
                onChange={(e) => setItemTypeRmKeywordsCsv(e.target.value)}
                aria-label="Custom RM classification keywords"
              />
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => void runPreview()}
              disabled={busy || !file || previewLocked}
              data-testid="tally-import-preview-btn"
            >
              {previewing ? "Previewing…" : "Preview import"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startOver}
              disabled={!startOverAllowed(busy)}
              data-testid="tally-import-start-over-btn"
            >
              Start over
            </Button>
            {summary ? (
              <Button type="button" variant="outline" size="sm" onClick={downloadFullPreviewCsv} disabled={busy}>
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
            {summary.partyRows ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <CountChip label="Party rows detected" value={summary.partyRows.totalRowsDetected} />
                <CountChip label="Eligible customers" value={summary.partyRows.eligibleCustomers} />
                <CountChip label="Eligible suppliers" value={summary.partyRows.eligibleSuppliers} />
                <CountChip
                  label="Excluded parent groups"
                  value={summary.partyRows.excludedParentGroup}
                  warn={summary.partyRows.excludedParentGroup > 0}
                />
                <CountChip label="Duplicates" value={summary.partyRows.duplicates} warn={summary.partyRows.duplicates > 0} />
                <CountChip label="Invalid rows" value={summary.partyRows.invalidRows} warn={summary.partyRows.invalidRows > 0} />
              </div>
            ) : null}
            {decodeMeta || summary.stockPreview ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs">
                  <div className="text-slate-500">Detected encoding</div>
                  <div className="font-semibold text-slate-900">{decodeMeta?.encoding || summary.stockPreview?.encoding || "—"}</div>
                </div>
                <CountChip label="STOCKITEM rows" value={summary.stockPreview?.totalStockItems ?? 0} />
                <CountChip
                  label="Sanitized invalid refs"
                  value={summary.stockPreview?.sanitizedInvalidRefCount ?? decodeMeta?.sanitizedInvalidRefCount ?? 0}
                  warn={(summary.stockPreview?.sanitizedInvalidRefCount ?? decodeMeta?.sanitizedInvalidRefCount ?? 0) > 0}
                />
                <CountChip label="Importable items" value={summary.stockPreview?.importable ?? 0} />
                <CountChip label="Excluded items" value={summary.stockPreview?.excluded ?? 0} warn={(summary.stockPreview?.excluded ?? 0) > 0} />
                <CountChip label="Unresolved GST" value={summary.stockPreview?.unresolvedGst ?? 0} warn={(summary.stockPreview?.unresolvedGst ?? 0) > 0} />
              </div>
            ) : null}
            {wizardStage === 2 && groupMapping.length ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800">
                  Stage 2 — Stock group → ERP type mapping (review required)
                </div>
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-white text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5">Tally group</th>
                      <th className="px-2 py-1.5">Count</th>
                      <th className="px-2 py-1.5">ERP type / Exclude</th>
                      <th className="px-2 py-1.5">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupMapping.map((g) => (
                      <tr key={g.groupKey} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-900">{g.tallyGroup || "(blank)"}</td>
                        <td className="px-2 py-1.5">{g.detectedCount}</td>
                        <td className="px-2 py-1.5">
                          <NativeSelect
                            className="w-full max-w-[11rem]"
                            value={groupTypeOverrides[g.groupKey] || g.choice}
                            disabled={!stage2Editable}
                            data-testid="tally-import-group-map-select"
                            onChange={(e) =>
                              setGroupTypeOverrides((prev) => ({ ...prev, [g.groupKey]: e.target.value }))
                            }
                          >
                            <option value="RM">RM</option>
                            <option value="FG">FG</option>
                            <option value="SFG">SFG (semi-finished)</option>
                            <option value="CONSUMABLE">CONSUMABLE</option>
                            <option value="PACKING">PACKING → CONSUMABLE</option>
                            <option value="SCRAP">SCRAP (exclude)</option>
                            <option value="EXCLUDE">EXCLUDE</option>
                          </NativeSelect>
                        </td>
                        <td className="px-2 py-1.5 text-slate-600">{g.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {wizardStage === 2 && unitMapping.length ? (
              <div className="overflow-x-auto rounded-md border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-800">
                  Stage 2 — Unit mapping (map to existing ERP units only)
                </div>
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-white text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5">Tally unit</th>
                      <th className="px-2 py-1.5">Count</th>
                      <th className="px-2 py-1.5">ERP unit</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitMapping.map((u) => (
                      <tr key={u.aliasKey} className="border-t border-slate-100">
                        <td className="px-2 py-1.5 font-medium text-slate-900">{u.sourceUnit}</td>
                        <td className="px-2 py-1.5">{u.detectedCount}</td>
                        <td className="px-2 py-1.5">
                          <input
                            className="w-full max-w-[10rem] rounded border border-slate-300 px-1.5 py-1 disabled:cursor-not-allowed disabled:opacity-60"
                            value={unitMapOverrides[u.aliasKey] ?? u.proposedErpUnitName ?? ""}
                            placeholder="Nos / Kg / …"
                            disabled={!stage2Editable}
                            data-testid="tally-import-unit-map-input"
                            onChange={(e) =>
                              setUnitMapOverrides((prev) => ({ ...prev, [u.aliasKey]: e.target.value }))
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5 text-slate-600">{u.unresolved ? "Unresolved" : "Mapped"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
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
                {parseStats.customFlatRowsDetected != null && parseStats.customFlatRowsDetected > 0
                  ? ` · CA* rows ${parseStats.customFlatRowsDetected}`
                  : ""}
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
                disabled={!stage2Editable}
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

function TallyImportProgressOverlay({
  view,
  blocking,
}: {
  view: TallyImportProgressView;
  blocking: boolean;
}) {
  const failed = view.phase === "failed";
  return (
    <div
      className={cn(
        "z-40 rounded-lg border px-4 py-3 shadow-sm",
        blocking
          ? "absolute inset-0 flex items-start justify-center bg-white/85 pt-16 backdrop-blur-[1px]"
          : "relative border-slate-200 bg-white",
        failed ? "border-red-200 bg-red-50" : "border-slate-200",
      )}
      data-testid="tally-import-progress-overlay"
      data-phase={view.phase}
      data-blocking={blocking ? "true" : "false"}
      aria-live="polite"
      role="status"
    >
      <div className={cn("w-full max-w-lg space-y-2", blocking && "rounded-lg border border-slate-200 bg-white p-4 shadow-md")}>
        <div className="flex items-start gap-2">
          {blocking && !failed ? (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-slate-700" aria-hidden />
          ) : failed ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">{view.stageLabel}</div>
            <div className="mt-0.5 truncate text-xs text-slate-600" data-testid="tally-import-progress-filename">
              {view.filename}
            </div>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800" data-testid="tally-import-progress-detail">
              {view.detail}
            </p>
            {view.stalled ? (
              <p className="mt-1 text-xs font-medium text-amber-800" data-testid="tally-import-progress-stall">
                Analysis is taking longer than expected
              </p>
            ) : null}
            {blocking && view.phase !== "importing" && view.phase !== "analysing" ? (
              <p className="mt-1 text-xs text-slate-500">Large Tally XML files may take a few minutes.</p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-slate-500" data-testid="tally-import-progress-elapsed">
              Elapsed: {formatElapsed(view.elapsedMs)}
              {view.etaLabel ? ` · ${view.etaLabel}` : null}
              {view.percent != null && !view.indeterminate ? ` · ${view.percent}%` : null}
            </p>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" data-testid="tally-import-progress-bar">
          {view.indeterminate ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-slate-600" style={{ animation: "pulse 1.2s ease-in-out infinite" }} />
          ) : (
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", failed ? "bg-red-600" : "bg-slate-800")}
              style={{ width: `${Math.max(0, Math.min(100, view.percent ?? 0))}%` }}
            />
          )}
        </div>
      </div>
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
  disabled = false,
}: {
  items: PreviewRow[];
  itemRowTypes: Record<string, DefaultItemType>;
  setItemRowTypes: React.Dispatch<React.SetStateAction<Record<string, DefaultItemType>>>;
  defaultItemType: DefaultItemType;
  disabled?: boolean;
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
                    disabled={disabled}
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
