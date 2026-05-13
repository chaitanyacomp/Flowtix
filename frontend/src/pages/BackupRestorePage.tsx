import * as React from "react";
import { AlertTriangle, Archive, Database, Download, HardDrive, RefreshCw, Trash2, X } from "lucide-react";
import { Navigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { apiFetch, ApiRequestError } from "../services/api";
import { apiDownloadAuthorized } from "../services/apiDownload";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { cn } from "../lib/utils";

type BackupType = "MANUAL" | "PRE_RESTORE_AUTO";
type BackupStatus = "CREATED" | "FAILED" | "RESTORED";

type BackupRow = {
  id: number;
  fileName: string;
  fileSizeBytes: number | null;
  backupType: BackupType;
  status: BackupStatus;
  createdAt: string;
  restoredAt: string | null;
  remarks: string | null;
  createdBy: { id: number; name: string; email: string } | null;
};

function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function typeLabel(t: BackupType): string {
  if (t === "MANUAL") return "Manual";
  return "Pre-restore";
}

function statusLabel(s: BackupStatus): string {
  return s.replace(/_/g, " ");
}

/** User-facing copy when the server reports an in-memory backup slot conflict. */
function formatBackupAdminError(e: unknown): string {
  if (e instanceof ApiRequestError && e.code === "BACKUP_BUSY") {
    return `Previous backup or restore may not have finished correctly, or another job is still running. ${e.message}`;
  }
  return e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Operation failed.";
}

function RestoreModal({
  open,
  backup,
  onClose,
  onDone,
}: {
  open: boolean;
  backup: BackupRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [adminPassword, setAdminPassword] = React.useState("");
  const [confirmPhrase, setConfirmPhrase] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const phraseRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setAdminPassword("");
    setConfirmPhrase("");
    setError(null);
    setSubmitting(false);
    const focusT = window.setTimeout(() => phraseRef.current?.focus(), 320);
    return () => window.clearTimeout(focusT);
  }, [open, backup?.id]);

  /** Browsers may hydrate autofill after paint — strip credential-like injections from the phrase field. */
  React.useEffect(() => {
    if (!open) return;
    const delays = [0, 16, 50, 120, 280];
    const handles = delays.map((ms) =>
      window.setTimeout(() => {
        setConfirmPhrase((prev) => {
          if (/@/.test(prev) || /\.(com|net|org|in|co)\b/i.test(prev)) return "";
          return prev;
        });
      }, ms),
    );
    return () => handles.forEach((h) => window.clearTimeout(h));
  }, [open, backup?.id]);

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !backup) return null;

  const backupId = backup.id;

  const phraseOk = confirmPhrase === "RESTORE";
  const canSubmit = phraseOk && adminPassword.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        message?: string;
        restartRequired?: boolean;
        backupHistoryUpdated?: boolean;
      }>(`/api/admin/backups/${backupId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          adminPassword: adminPassword.trim(),
          confirmPhrase: confirmPhrase,
        }),
      });
      toast.showSuccess(res.message ?? "Restore completed.");
      onDone();
      onClose();
    } catch (e) {
      setError(formatBackupAdminError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="erp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="erp-modal-shell max-w-lg border-red-200">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-red-100 bg-red-50/80 pb-3">
          <CardTitle id="restore-modal-title" className="text-lg font-semibold tracking-tight text-red-950">
            Restore database
          </CardTitle>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Section 1 — Warning */}
          <section className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" aria-labelledby="restore-warn-title">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
              <div className="space-y-1">
                <div id="restore-warn-title" className="font-semibold">
                  This replaces the live database.
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-amber-950/90">
                  <li>The system creates an automatic safety backup first.</li>
                  <li>All users should stop using the ERP during restore.</li>
                  <li>Restart the API server after restore, then sign in again.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Section 2 — Selected file */}
          <section className="rounded-md border border-slate-200 bg-slate-50 p-3" aria-labelledby="restore-file-title">
            <div id="restore-file-title" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Selected backup file
            </div>
            <div className="mt-1.5 break-all font-mono text-[13px] text-slate-900">{backup.fileName}</div>
          </section>

          <form
            className="relative space-y-4"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) void submit();
            }}
          >
            {/* Hidden trap: password managers target these instead of the real phrase box. */}
            <div className="absolute left-0 top-0 z-0 h-0 w-0 overflow-hidden p-0 opacity-0" aria-hidden="true">
              <input type="text" name="trap_u_erp_bk_rnd" autoComplete="username" tabIndex={-1} />
              <input type="password" name="trap_p_erp_bk_rnd" autoComplete="current-password" tabIndex={-1} />
            </div>

            {/* Section 3 — Confirmation phrase */}
            <section className="rounded-md border border-slate-200 bg-white p-3" aria-labelledby="restore-phrase-label">
              <label id="restore-phrase-label" htmlFor="restore_phrase_guard" className="block text-sm font-semibold text-slate-900">
                Type RESTORE to confirm
              </label>
              <p className="mt-0.5 text-xs text-slate-500">Type the word RESTORE exactly. This field is not for email or login.</p>
              <Input
                ref={phraseRef}
                id="restore_phrase_guard"
                name="restore_phrase_guard"
                type="text"
                inputMode="text"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="new-password"
                data-1p-ignore
                data-lpignore
                data-form-type="other"
                value={confirmPhrase}
                onInput={(e) => {
                  const raw = e.currentTarget.value;
                  if (/@/.test(raw)) {
                    setConfirmPhrase("");
                    e.currentTarget.value = "";
                  }
                }}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 7);
                  setConfirmPhrase(v);
                }}
                placeholder="Type RESTORE here"
                className="mt-2 font-mono tracking-wide"
                aria-invalid={confirmPhrase.length > 0 && !phraseOk}
              />
            </section>

            {/* Section 4 — Admin password */}
            <section className="rounded-md border border-slate-200 bg-white p-3" aria-labelledby="restore-pw-label">
              <label id="restore-pw-label" htmlFor="restore_acct_chk_9k4" className="block text-sm font-semibold text-slate-900">
                Enter current admin password
              </label>
              <p className="mt-0.5 text-xs text-slate-600">For security, enter current admin password.</p>
              <Input
                id="restore_acct_chk_9k4"
                name="restore_acct_chk_9k4"
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Password"
                className="mt-2"
              />
            </section>

            {error ? (
              <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 pt-0.5">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="outline"
                disabled={!canSubmit}
                className={cn(
                  "min-w-[10.5rem] border-orange-700 bg-orange-600 font-semibold text-white hover:bg-orange-700",
                  "disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500 disabled:hover:bg-slate-200",
                )}
              >
                {submitting ? "Restoring…" : "Restore Database"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function BackupRestorePage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [rows, setRows] = React.useState<BackupRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [remarks, setRemarks] = React.useState("");
  const [restoreTarget, setRestoreTarget] = React.useState<BackupRow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<BackupRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const createGuard = React.useRef(false);

  async function loadList() {
    setLoadError(null);
    try {
      const data = await apiFetch<{ backups: BackupRow[] }>("/api/admin/backups");
      setRows(data.backups);
    } catch (e) {
      setLoadError(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Failed to load backups.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadList();
  }, []);

  async function onCreateBackup() {
    if (creating || createGuard.current) return;
    createGuard.current = true;
    setCreating(true);
    try {
      await apiFetch("/api/admin/backups", {
        method: "POST",
        body: JSON.stringify({ remarks: remarks.trim() || undefined }),
      });
      toast.showSuccess("Backup created.");
      setRemarks("");
      await loadList();
    } catch (e) {
      toast.showError(formatBackupAdminError(e));
    } finally {
      setCreating(false);
      createGuard.current = false;
    }
  }

  async function onDownload(b: BackupRow) {
    try {
      await apiDownloadAuthorized(`/api/admin/backups/${b.id}/download`, b.fileName);
      toast.showSuccess("Download started.");
    } catch (e) {
      toast.showError(e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Download failed.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/admin/backups/${deleteTarget.id}`, { method: "DELETE" });
      toast.showSuccess("Backup deleted.");
      setDeleteTarget(null);
      await loadList();
    } catch (e) {
      toast.showError(formatBackupAdminError(e));
    } finally {
      setDeleting(false);
    }
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-5">
      <PageHeader title="Backup & Restore" />

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        <div className="flex items-start gap-2">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
          <div>
            Full MySQL dumps for disaster recovery. Requires <span className="font-medium">mysqldump</span> and{" "}
            <span className="font-medium">mysql</span> on the server PATH (or set MYSQLDUMP_PATH / MYSQL_PATH in backend{" "}
            <code className="rounded bg-white px-1 text-xs">.env</code>).
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
      ) : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 py-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Archive className="h-4 w-4 text-slate-600" />
            Create backup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <p className="text-sm text-slate-600">Creates a full .sql dump (masters and transactions). Stored outside the application source tree.</p>
          <div className="flex max-w-xl flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-700" htmlFor="bk-remarks">
                Remarks (optional)
              </label>
              <Input id="bk-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Before month-end" />
            </div>
            <Button type="button" className="shrink-0" disabled={creating || loading} onClick={() => void onCreateBackup()}>
              {creating ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Working…
                </>
              ) : (
                <>
                  <HardDrive className="mr-2 h-4 w-4" />
                  Create backup
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-base font-semibold text-slate-900">Backup history</CardTitle>
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-amber-900/90">
                <span className="inline-flex shrink-0 rounded border border-amber-300/80 bg-amber-50 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-amber-950">
                  Restore
                </span>
                <span>replaces the current database. Use only during maintenance.</span>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 gap-1.5 border border-slate-200 bg-white px-2.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              disabled={loading}
              title="Reload backup list from server"
              onClick={() => void loadList()}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 shrink-0 text-slate-500", loading && "animate-spin")} aria-hidden />
              <span className="text-xs font-medium">Refresh list</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] table-fixed text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="w-[11.5rem] px-3 py-2">Date</th>
                  <th className="w-[5.5rem] px-3 py-2 text-right">Size</th>
                  <th className="w-[6.5rem] px-3 py-2">Type</th>
                  <th className="w-[6.5rem] px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created by</th>
                  <th className="w-[17.5rem] px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      No backups yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 align-middle text-slate-800">
                        {new Date(r.createdAt).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-middle text-right tabular-nums text-slate-800">
                        {formatBytes(r.fileSizeBytes)}
                      </td>
                      <td className="px-3 py-2 align-middle text-slate-800">{typeLabel(r.backupType)}</td>
                      <td className="px-3 py-2 align-middle text-slate-800">{statusLabel(r.status)}</td>
                      <td className="truncate px-3 py-2 align-middle text-slate-700" title={r.createdBy?.email ?? ""}>
                        {r.createdBy?.name ?? "—"}
                      </td>
                      <td className="px-2 py-2 align-middle text-right">
                        <div className="flex flex-nowrap justify-end gap-1.5">
                          <Button
                            type="button"
                            variant={r.status === "CREATED" ? "default" : "outline"}
                            size="sm"
                            className="h-8 shrink-0 gap-1 px-2 text-xs font-medium"
                            disabled={r.status !== "CREATED"}
                            onClick={() => void onDownload(r)}
                            title={r.status !== "CREATED" ? "Only completed backups can be downloaded" : "Download this backup as .sql"}
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Download
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={cn(
                              "h-8 shrink-0 gap-1 border-amber-500/90 bg-amber-50 px-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 hover:text-amber-950",
                              "disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:bg-slate-50 disabled:hover:text-slate-400",
                            )}
                            disabled={r.backupType !== "MANUAL" || r.status !== "CREATED"}
                            onClick={() => setRestoreTarget(r)}
                            title={
                              r.backupType !== "MANUAL" || r.status !== "CREATED"
                                ? "Only manual backups in Created status can be restored"
                                : "Restore this backup"
                            }
                          >
                            <Database className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Restore
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-8 shrink-0 gap-1 px-2 text-xs font-medium"
                            onClick={() => setDeleteTarget(r)}
                            title="Delete this backup from history and disk"
                          >
                            <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <RestoreModal
        open={restoreTarget != null}
        backup={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onDone={() => void loadList()}
      />

      {deleteTarget ? (
        <div
          className="erp-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-bk-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <Card className="erp-modal-shell max-w-md">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-200 pb-3">
              <CardTitle id="del-bk-title" className="text-base font-semibold">
                Delete backup
              </CardTitle>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Close" onClick={() => setDeleteTarget(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <p className="text-sm text-slate-600">
                Remove <span className="font-mono text-xs">{deleteTarget.fileName}</span> from history and disk?
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={() => void confirmDelete()}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
