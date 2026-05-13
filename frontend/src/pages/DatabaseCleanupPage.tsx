import * as React from "react";
import { AlertTriangle, Database, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { useToast } from "../contexts/ToastContext";

type SummaryRow = { table: string; deleted: number };

type ResetResponse = { ok: true; summary: SummaryRow[] };

type FullDemoResetResponse = {
  success: true;
  message: string;
  deleted: Record<string, number>;
};

type NoQtyResetResponse = {
  success: true;
  deletedCounts: Record<string, number>;
};

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-IN").format(Math.trunc(n));
}

function SummaryTable({ rows }: { rows: SummaryRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2">Table</th>
            <th className="px-3 py-2 text-right">Deleted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.table} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">{r.table}</td>
              <td className="px-3 py-2 text-right tabular-nums text-slate-800">{formatInt(r.deleted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WarningModal({
  open,
  onClose,
  onConfirm,
  confirmText,
  setConfirmText,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmText: string;
  setConfirmText: (v: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onConfirm]);

  if (!open) return null;

  const typedOk = confirmText.trim().toUpperCase() === "RESET";
  const confirmDisabled = submitting || !typedOk;

  return (
    <div
      className="erp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="db-cleanup-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="erp-modal-shell max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 pb-3">
          <CardTitle id="db-cleanup-modal-title" className="text-lg font-semibold tracking-tight">
            Confirm Database Cleanup
          </CardTitle>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <div className="font-semibold">This will permanently delete transaction data.</div>
                <div className="text-amber-950/80">
                  Master data is preserved (users, roles, items, customers, suppliers, units, settings, GST/HSN masters).
                  This action runs inside a single DB transaction; any failure will roll back everything.
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-700">
            <div className="font-medium text-slate-900">
              Type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code> to enable the button.
            </div>
            <Input
              ref={inputRef}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET"
              autoComplete="off"
            />
          </div>

          {error ? (
            <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
              {submitting ? "Resetting…" : "Reset Transaction Data"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FullDemoResetModal({
  open,
  onClose,
  onConfirm,
  confirmText,
  setConfirmText,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmText: string;
  setConfirmText: (v: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onConfirm]);

  if (!open) return null;

  const typedOk = confirmText.trim().toUpperCase() === "FULL RESET";
  const confirmDisabled = submitting || !typedOk;

  return (
    <div
      className="erp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="full-demo-reset-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="erp-modal-shell max-w-lg border-red-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-red-100 bg-red-50/80 pb-3">
          <CardTitle id="full-demo-reset-modal-title" className="text-lg font-semibold tracking-tight text-red-950">
            Confirm Full Demo Reset
          </CardTitle>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div className="space-y-2">
                <div className="font-semibold">This cannot be undone.</div>
                <div className="text-red-950/90">
                  Deletes <strong>all</strong> ERP business data including transactions <strong>and</strong> masters: items, customers,
                  suppliers, units, BOM, opening stock, customer POs, and related rows. User accounts and login access are{" "}
                  <strong>not</strong> removed. App settings and state/GST reference masters are preserved for a working shell after
                  import.
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-700">
            <div className="font-medium text-slate-900">
              Type <code className="rounded bg-slate-100 px-1 py-0.5">FULL RESET</code> to enable the button.
            </div>
            <Input
              ref={inputRef}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type FULL RESET"
              autoComplete="off"
              className="border-red-200 focus-visible:ring-red-400"
            />
          </div>

          {error ? (
            <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirm} disabled={confirmDisabled}>
              {submitting ? "Resetting…" : "Full Demo Reset"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NoQtyResetModal({
  open,
  onClose,
  onConfirm,
  confirmText,
  setConfirmText,
  submitting,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirmText: string;
  setConfirmText: (v: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter") onConfirm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onConfirm]);

  if (!open) return null;

  const typedOk = confirmText.trim().toUpperCase() === "RESET";
  const confirmDisabled = submitting || !typedOk;

  return (
    <div
      className="erp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="noqty-reset-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="erp-modal-shell max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 pb-3">
          <CardTitle id="noqty-reset-modal-title" className="text-lg font-semibold tracking-tight">
            Confirm NO_QTY Data Reset
          </CardTitle>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <div className="font-semibold">This will permanently delete NO_QTY transactional data.</div>
                <div className="text-amber-950/80">
                  Sales orders with order type NO_QTY and all related cycles, work orders, production, QC, dispatch, sales bills, and stock
                  entries for those orders will be removed. Master data (items, customers, users, etc.) is preserved.
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-700">
            <div className="font-medium text-slate-900">
              Type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code> to enable the button.
            </div>
            <Input
              ref={inputRef}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET"
              autoComplete="off"
            />
          </div>

          {error ? (
            <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={onConfirm} disabled={confirmDisabled}>
              {submitting ? "Resetting…" : "Reset NO_QTY Data"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function DatabaseCleanupPage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<SummaryRow[]>([]);

  const [fullModalOpen, setFullModalOpen] = React.useState(false);
  const [fullConfirmText, setFullConfirmText] = React.useState("");
  const [fullSubmitting, setFullSubmitting] = React.useState(false);
  const [fullError, setFullError] = React.useState<string | null>(null);
  const [fullDeleted, setFullDeleted] = React.useState<Record<string, number> | null>(null);

  const [noQtyModalOpen, setNoQtyModalOpen] = React.useState(false);
  const [noQtyConfirmText, setNoQtyConfirmText] = React.useState("");
  const [noQtySubmitting, setNoQtySubmitting] = React.useState(false);
  const [noQtyError, setNoQtyError] = React.useState<string | null>(null);

  function openModal() {
    setModalOpen(true);
    setConfirmText("");
    setError(null);
  }

  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
    setError(null);
  }

  function openFullModal() {
    setFullModalOpen(true);
    setFullConfirmText("");
    setFullError(null);
  }

  function closeFullModal() {
    if (fullSubmitting) return;
    setFullModalOpen(false);
    setFullError(null);
  }

  function openNoQtyModal() {
    setNoQtyModalOpen(true);
    setNoQtyConfirmText("");
    setNoQtyError(null);
  }

  function closeNoQtyModal() {
    if (noQtySubmitting) return;
    setNoQtyModalOpen(false);
    setNoQtyError(null);
  }

  async function runReset() {
    if (submitting) return;
    if (confirmText.trim().toUpperCase() !== "RESET") {
      setError("Type RESET to enable this action.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<ResetResponse>("/api/admin/database-cleanup/reset-transaction-data", {
        method: "POST",
        body: JSON.stringify({ confirmText }),
      });
      setSummary(res.summary ?? []);
      toast.showSuccess("Transaction data reset completed.");
      setModalOpen(false);
    } catch (e) {
      if (e instanceof ApiRequestError && e.step) {
        const msg = `Cleanup failed at: ${e.step}\n${e.backendError ?? e.message}`;
        setError(msg);
        toast.showError(`Cleanup failed at: ${e.step}`);
      } else {
        const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Request failed";
        setError(msg);
        toast.showError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function runFullDemoReset() {
    if (fullSubmitting) return;
    if (fullConfirmText.trim().toUpperCase() !== "FULL RESET") {
      setFullError("Type FULL RESET to enable this action.");
      return;
    }
    setFullSubmitting(true);
    setFullError(null);
    try {
      const res = await apiFetch<FullDemoResetResponse>("/api/admin/database-cleanup/full-demo-reset", {
        method: "POST",
        body: JSON.stringify({ confirmText: fullConfirmText }),
      });
      setFullDeleted(res.deleted ?? {});
      toast.showSuccess(res.message ?? "Full demo reset completed.");
      setFullModalOpen(false);
    } catch (e) {
      if (e instanceof ApiRequestError && e.step) {
        const msg = `Full reset failed at: ${e.step}\n${e.backendError ?? e.message}`;
        setFullError(msg);
        toast.showError(`Full reset failed at: ${e.step}`);
      } else {
        const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Request failed";
        setFullError(msg);
        toast.showError(msg);
      }
    } finally {
      setFullSubmitting(false);
    }
  }

  async function runNoQtyReset() {
    if (noQtySubmitting) return;
    if (noQtyConfirmText.trim().toUpperCase() !== "RESET") {
      setNoQtyError("Type RESET to enable this action.");
      return;
    }
    setNoQtySubmitting(true);
    setNoQtyError(null);
    try {
      await apiFetch<NoQtyResetResponse>("/api/admin/reset-noqty-data", {
        method: "POST",
        body: JSON.stringify({ confirmText: "RESET" }),
      });
      toast.showSuccess("NO_QTY data reset completed.");
      setNoQtyModalOpen(false);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (e) {
      if (e instanceof ApiRequestError && e.step) {
        const msg = `NO_QTY reset failed at: ${e.step}\n${e.backendError ?? e.message}`;
        setNoQtyError(msg);
        toast.showError(`NO_QTY reset failed at: ${e.step}`);
      } else {
        const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Request failed";
        setNoQtyError(msg);
        toast.showError(msg);
      }
    } finally {
      setNoQtySubmitting(false);
    }
  }

  const fullSummaryRows: SummaryRow[] = React.useMemo(() => {
    if (!fullDeleted) return [];
    return Object.entries(fullDeleted).map(([table, deleted]) => ({ table, deleted }));
  }, [fullDeleted]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-slate-700" />
            Database Cleanup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-slate-700">
            Admin-only tools for testing. Use transaction reset for day-to-day sandbox refresh; use full demo reset only when you need to
            wipe masters before re-importing from Tally.
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Reset Transaction Data</div>
            <div className="mt-1 text-slate-700/90">
              Deletes only transaction records in dependency-safe order and resets related document sequences (SO, WO, PE, QC, D, SB, RS
              where available).
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={openModal} disabled={submitting || fullSubmitting}>
              Reset Transaction Data
            </Button>
            <div className="text-xs text-slate-500">
              You will be asked to type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code>.
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div className="font-semibold text-slate-900">Reset NO_QTY Data</div>
              <div className="mt-1 text-slate-700/90">
                Deletes only NO_QTY Sales Orders and related cycles, work orders, production, QC, dispatch, sales bills, and stock entries.
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={openNoQtyModal} disabled={submitting || fullSubmitting || noQtySubmitting}>
                Reset NO_QTY Data
              </Button>
              <div className="text-xs text-slate-500">
                You will be asked to type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code>.
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-sm text-red-950">
              <div className="font-semibold text-red-950">Full Demo Reset</div>
              <div className="mt-1 text-red-950/90">
                Deletes transactions <strong>and</strong> masters including Items, Customers, Suppliers, Units, BOM, Opening Stock,
                Customer PO, and related ERP rows. User accounts are kept; app settings module is not cleared.{" "}
                <span className="font-semibold">This cannot be undone.</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="destructive" onClick={openFullModal} disabled={submitting || fullSubmitting}>
                Full Demo Reset
              </Button>
              <div className="text-xs text-slate-600">
                Confirmation phrase: <code className="rounded bg-slate-100 px-1 py-0.5">FULL RESET</code>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {summary.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Deleted records summary (transactions)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryTable rows={summary} />
          </CardContent>
        </Card>
      ) : null}

      {fullSummaryRows.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Full demo reset — deleted counts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryTable rows={fullSummaryRows} />
          </CardContent>
        </Card>
      ) : null}

      <WarningModal
        open={modalOpen}
        onClose={closeModal}
        onConfirm={() => void runReset()}
        confirmText={confirmText}
        setConfirmText={setConfirmText}
        submitting={submitting}
        error={error}
      />

      <FullDemoResetModal
        open={fullModalOpen}
        onClose={closeFullModal}
        onConfirm={() => void runFullDemoReset()}
        confirmText={fullConfirmText}
        setConfirmText={setFullConfirmText}
        submitting={fullSubmitting}
        error={fullError}
      />

      <NoQtyResetModal
        open={noQtyModalOpen}
        onClose={closeNoQtyModal}
        onConfirm={() => void runNoQtyReset()}
        confirmText={noQtyConfirmText}
        setConfirmText={setNoQtyConfirmText}
        submitting={noQtySubmitting}
        error={noQtyError}
      />
    </div>
  );
}
