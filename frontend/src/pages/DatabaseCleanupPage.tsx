import * as React from "react";
import { AlertTriangle, Database, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { useToast } from "../contexts/ToastContext";

type SummaryRow = { table: string; deleted: number };

type ResetResponse = { ok: true; summary: SummaryRow[] };

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
            <div className="font-medium text-slate-900">Type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code> to enable the button.</div>
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

export function DatabaseCleanupPage() {
  const toast = useToast();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<SummaryRow[]>([]);

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
            Admin-only tool for fresh process testing. This clears transactional rows (orders, work orders, production, QC, dispatch, billing, purchase flows, stock
            transactions) while keeping master data intact.
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <div className="font-semibold text-slate-900">Reset Transaction Data</div>
            <div className="mt-1 text-slate-700/90">
              Deletes only transaction records in dependency-safe order and resets related document sequences (SO, WO, PE, QC, D, SB, RS where available).
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={openModal} disabled={submitting}>
              Reset Transaction Data
            </Button>
            <div className="text-xs text-slate-500">
              You will be asked to type <code className="rounded bg-slate-100 px-1 py-0.5">RESET</code>.
            </div>
          </div>
        </CardContent>
      </Card>

      {summary.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Deleted records summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <SummaryTable rows={summary} />
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
    </div>
  );
}

