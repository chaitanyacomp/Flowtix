import * as React from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Download } from "lucide-react";
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

type PreviewRow = {
  entityType: string;
  tallyName: string;
  proposedAction: ProposedAction;
  existingErpId: number | null;
  warnings: string[];
  errors: string[];
  mapped: Record<string, unknown>;
};

type PreviewSummary = {
  customers: { total: number; create: number; skip: number; update: number; error: number };
  suppliers: { total: number; create: number; skip: number; update: number; error: number };
  items: { total: number; create: number; skip: number; update: number; error: number };
  units: { total: number; create: number; skip: number; update: number; error: number };
};

type ParseStats = {
  tallyMessageOpenInRaw: number;
  ledgerOpenInRaw: number;
  stockItemOpenInRaw: number;
  unitOpenInRaw: number;
  ledgersParsed: number;
  stockItemsParsed: number;
  unitsParsed: number;
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
};

type StateOpt = { id: number; stateName: string; stateCode: string };

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

function previewRowsToCsv(rows: PreviewRow[], fileSuffix: string): void {
  const header = "Entity,Tally name,Proposed action,Existing ERP id,Warnings,Errors,Mapped JSON\n";
  const lines = rows.map((r) =>
    [
      escCsvCell(r.entityType),
      escCsvCell(r.tallyName),
      escCsvCell(r.proposedAction),
      escCsvCell(r.existingErpId != null ? String(r.existingErpId) : ""),
      escCsvCell(r.warnings.join("; ")),
      escCsvCell(r.errors.join("; ")),
      escCsvCell(JSON.stringify(r.mapped)),
    ].join(","),
  );
  downloadCsv(`tally-import-preview-${fileSuffix}.csv`, header, lines);
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
  const [summary, setSummary] = React.useState<PreviewSummary | null>(null);
  const [customers, setCustomers] = React.useState<PreviewRow[]>([]);
  const [suppliers, setSuppliers] = React.useState<PreviewRow[]>([]);
  const [items, setItems] = React.useState<PreviewRow[]>([]);
  const [units, setUnits] = React.useState<PreviewRow[]>([]);
  const [parseStats, setParseStats] = React.useState<ParseStats | null>(null);
  const [applyResult, setApplyResult] = React.useState<ApplyResult | null>(null);
  /** Per Tally stock-item name → RM | FG for import apply (initialized from preview). */
  const [itemRowTypes, setItemRowTypes] = React.useState<Record<string, DefaultItemType>>({});
  const [tab, setTab] = React.useState<"customers" | "suppliers" | "items" | "units" | "alerts">("customers");

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
    setApplyResult(null);
    setWarnings([]);
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
        const msg = data?.error?.message || `Preview failed (${res.status})`;
        throw new ApiRequestError(msg, res.status, data?.error?.code);
      }
      setPreviewToken(data.previewToken);
      setWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setSummary(data.summary);
      setCustomers(data.customers ?? []);
      setSuppliers(data.suppliers ?? []);
      setItems(data.items ?? []);
      setUnits(data.units ?? []);
      setParseStats(data.parseStats ?? null);
      const itemList: PreviewRow[] = data.items ?? [];
      const initTypes: Record<string, DefaultItemType> = {};
      for (const r of itemList) {
        const t = r.mapped?.suggestedItemType;
        initTypes[r.tallyName] = t === "RM" || t === "FG" ? t : defaultItemType;
      }
      setItemRowTypes(initTypes);
      toast.showSuccess("Preview ready. Review the tabs, then confirm import.");
    } catch (e) {
      toast.showError(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Preview failed.");
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
        "This updates live master data (only as shown in the preview). " +
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
      toast.showSuccess(
        `Import finished: ${out.created} created, ${out.updated} updated, ${out.skipped} skipped, ${out.failed} failed.`,
      );
      setPreviewToken(null);
      setItemRowTypes({});
    } catch (e) {
      toast.showError(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Import failed.");
    } finally {
      setApplying(false);
    }
  }

  function downloadFullPreviewCsv() {
    const all = [...units, ...customers, ...suppliers, ...items];
    const header = "Entity,Tally name,Proposed action,Existing ERP id,Warnings,Errors,Mapped JSON\n";
    const lines = all.map((r) =>
      [
        escCsvCell(r.entityType),
        escCsvCell(r.tallyName),
        escCsvCell(r.proposedAction),
        escCsvCell(r.existingErpId != null ? String(r.existingErpId) : ""),
        escCsvCell(r.warnings.join("; ")),
        escCsvCell(r.errors.join("; ")),
        escCsvCell(JSON.stringify(r.mapped)),
      ].join(","),
    );
    downloadCsv("tally-import-preview-all.csv", header, lines);
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
            <span className="mt-1 block text-xs text-slate-500">
              Uses Tally stock group fields on each <span className="font-mono">STOCKITEM</span> (<span className="font-mono">PARENT</span>,{" "}
              <span className="font-mono">CATEGORY</span>, <span className="font-mono">STOCKGROUP</span>). Leave blank for built-in keyword lists.
            </span>
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryChip label="Customers" s={summary.customers} />
              <SummaryChip label="Suppliers" s={summary.suppliers} />
              <SummaryChip label="Items" s={summary.items} />
              <SummaryChip label="Units" s={summary.units} />
            </div>
            {parseStats ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-[11px] leading-relaxed text-slate-700">
                <span className="font-sans font-semibold text-slate-800">XML scan: </span>
                raw &lt;TALLYMESSAGE&gt; {parseStats.tallyMessageOpenInRaw} · &lt;LEDGER&gt; {parseStats.ledgerOpenInRaw} ·
                &lt;STOCKITEM&gt; {parseStats.stockItemOpenInRaw} · &lt;UNIT&gt; {parseStats.unitOpenInRaw} → parsed LEDGER{" "}
                {parseStats.ledgersParsed} · STOCKITEM {parseStats.stockItemsParsed} · UNIT {parseStats.unitsParsed}
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
              <div className="max-h-72 space-y-2 overflow-auto text-sm">
                {warnings.map((w) => (
                  <div key={w} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">
                    {w}
                  </div>
                ))}
                {[...customers, ...suppliers, ...items, ...units].flatMap((r) =>
                  [...r.warnings.map((x) => ({ r, x, kind: "w" as const })), ...r.errors.map((x) => ({ r, x, kind: "e" as const }))].map(
                    ({ r, x, kind }, i) => (
                      <div
                        key={`${r.entityType}-${r.tallyName}-${kind}-${i}`}
                        className={cn(
                          "rounded border px-2 py-1",
                          kind === "e" ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-800",
                        )}
                      >
                        <span className="font-medium">{r.entityType}</span> · {r.tallyName}: {x}
                      </div>
                    ),
                  ),
                )}
              </div>
            ) : tab === "items" ? (
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
                      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const unit = String(r.mapped?.baseUnit ?? "").trim() || "—";
                      const hsn = String(r.mapped?.hsnCode ?? "").trim() || "—";
                      const gstRaw = r.mapped?.gstRate;
                      const gst =
                        gstRaw != null && gstRaw !== "" && Number.isFinite(Number(gstRaw)) ? String(Number(gstRaw)) : "—";
                      const stockGroup = String(r.mapped?.tallyStockGroup ?? "").trim() || "—";
                      const auto = r.mapped?.autoDetectedItemType;
                      const rowType =
                        itemRowTypes[r.tallyName] ??
                        (r.mapped?.suggestedItemType === "RM" || r.mapped?.suggestedItemType === "FG"
                          ? r.mapped.suggestedItemType
                          : defaultItemType);
                      return (
                        <tr key={`ITEM-${r.tallyName}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80">
                          <td className="px-2 py-1 align-top font-medium text-slate-900">{r.tallyName}</td>
                          <td className="max-w-[100px] truncate px-2 py-1 align-top text-slate-800" title={unit}>
                            {unit}
                          </td>
                          <td className="px-2 py-1 align-top font-mono text-[11px] text-slate-800">{hsn}</td>
                          <td className="px-2 py-1 align-top tabular-nums text-slate-800">{gst}</td>
                          <td
                            className="max-w-[140px] truncate px-2 py-1 align-top text-slate-700"
                            title={stockGroup === "—" ? undefined : stockGroup}
                          >
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
                          <td className="min-w-[100px] px-2 py-1 align-top text-slate-600">
                            {[...r.warnings, ...r.errors].join(" · ") || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="max-h-80 overflow-auto rounded border border-slate-200">
                <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Name</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Action</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Match id</th>
                      <th className="border-b border-slate-200 px-2 py-1.5 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRows.map((r) => (
                      <tr key={`${r.entityType}-${r.tallyName}`} className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80">
                        <td className="px-2 py-1 align-top font-medium text-slate-900">{r.tallyName}</td>
                        <td className="px-2 py-1 align-top">{r.proposedAction}</td>
                        <td className="px-2 py-1 align-top">{r.existingErpId ?? "—"}</td>
                        <td className="px-2 py-1 align-top text-slate-600">
                          {[...r.warnings, ...r.errors].join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="button" onClick={() => void runApply()} disabled={applying || !previewToken} className="bg-emerald-700 hover:bg-emerald-800">
                {applying ? "Importing…" : "Confirm import"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => previewRowsToCsv(activeRows, tab)}
                disabled={tab === "alerts" || activeRows.length === 0}
              >
                Tab CSV
              </Button>
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
          contains voucher sections, they are ignored and you will see a notice.
        </CardContent>
      </Card>
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
