import * as React from "react";
import { Navigate } from "react-router-dom";
import { KeyRound, Plus, Search, Users, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ErpModal } from "../components/erp/ErpModal";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "../contexts/ToastContext";
import { apiFetch } from "../services/api";

type UserRole = "ADMIN" | "STORE" | "PURCHASE" | "PRODUCTION" | "QA";

type AdminUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const ROLES: UserRole[] = ["ADMIN", "STORE", "PURCHASE", "PRODUCTION", "QA"];

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: "Admin",
  STORE: "Store",
  PURCHASE: "Purchase",
  PRODUCTION: "Production",
  QA: "QA",
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminUsersPage() {
  const isAdmin = useIsAdmin();
  const { user: me } = useAuth();
  const toast = useToast();

  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);

  const [q, setQ] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<"" | UserRole>("");
  const [activeFilter, setActiveFilter] = React.useState<"" | "true" | "false">("");

  const [createForm, setCreateForm] = React.useState({
    email: "",
    name: "",
    role: "STORE" as UserRole,
    password: "",
    isActive: true,
  });

  const [resetTarget, setResetTarget] = React.useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = React.useState("");
  const [resetConfirm, setResetConfirm] = React.useState("");
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [resetting, setResetting] = React.useState(false);

  async function loadUsers(filters?: { q?: string; role?: string; active?: string }) {
    const nextQ = filters?.q ?? q;
    const nextRole = filters?.role ?? roleFilter;
    const nextActive = filters?.active ?? activeFilter;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextQ.trim()) params.set("q", nextQ.trim());
      if (nextRole) params.set("role", nextRole);
      if (nextActive) params.set("active", nextActive);
      const qs = params.toString();
      const data = await apiFetch<{ users: AdminUser[] }>(`/api/admin/users${qs ? `?${qs}` : ""}`);
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      toast.showError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!isAdmin) return;
    void loadUsers();
    // Initial load only; filters apply via Apply button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) return <Navigate to="/" replace />;

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.email.trim() || !createForm.name.trim() || !createForm.password) {
      toast.showError("Email, name, and password are required.");
      return;
    }
    if (createForm.password.length < 6) {
      toast.showError("Password must be at least 6 characters.");
      return;
    }
    setCreating(true);
    try {
      await apiFetch<{ user: AdminUser }>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: createForm.email.trim(),
          name: createForm.name.trim(),
          role: createForm.role,
          password: createForm.password,
          isActive: createForm.isActive,
        }),
      });
      toast.showSuccess("User created");
      setCreateForm({ email: "", name: "", role: "STORE", password: "", isActive: true });
      await loadUsers();
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(id: number, patch: { name?: string; role?: UserRole; isActive?: boolean }) {
    setBusyId(id);
    try {
      await apiFetch<{ user: AdminUser }>(`/api/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast.showSuccess("User updated");
      await loadUsers();
    } catch (err) {
      toast.showError(err instanceof Error ? err.message : "Could not update user");
    } finally {
      setBusyId(null);
    }
  }

  function openReset(u: AdminUser) {
    setResetTarget(u);
    setResetPassword("");
    setResetConfirm("");
    setResetError(null);
  }

  function closeReset() {
    if (resetting) return;
    setResetTarget(null);
    setResetPassword("");
    setResetConfirm("");
    setResetError(null);
  }

  async function submitReset() {
    if (!resetTarget) return;
    if (resetPassword.length < 6) {
      setResetError("Password must be at least 6 characters.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("Passwords do not match.");
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      await apiFetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      toast.showSuccess(`Password reset for ${resetTarget.email}`);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Users</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Create and manage ERP logins. Roles control which modules a user can open.
        </p>
      </div>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Plus className="h-4 w-4 text-slate-600" aria-hidden />
            Create user
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <form onSubmit={(e) => void onCreate(e)} className="erp-form grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="erp-form-field sm:col-span-2 lg:col-span-2">
              <span className="erp-form-label">Email *</span>
              <Input
                type="email"
                className="h-9"
                autoComplete="off"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
            <label className="erp-form-field lg:col-span-1">
              <span className="erp-form-label">Name *</span>
              <Input
                className="h-9"
                autoComplete="off"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="erp-form-field lg:col-span-1">
              <span className="erp-form-label">Role *</span>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 shadow-sm"
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field lg:col-span-1">
              <span className="erp-form-label">Password *</span>
              <Input
                type="password"
                className="h-9"
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              />
            </label>
            <div className="flex flex-wrap items-end gap-3 lg:col-span-6">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={createForm.isActive}
                  onChange={(e) => setCreateForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Active
              </label>
              <Button type="submit" className="h-9" disabled={creating}>
                {creating ? "Creating…" : "Create user"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Users className="h-4 w-4 text-slate-600" aria-hidden />
            User list
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="erp-form-field min-w-[12rem] flex-1">
              <span className="erp-form-label">Search</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  className="h-9 pl-8"
                  placeholder="Name or email"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loadUsers();
                  }}
                />
              </div>
            </label>
            <label className="erp-form-field w-36">
              <span className="erp-form-label">Role</span>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "" | UserRole)}
              >
                <option value="">All</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="erp-form-field w-36">
              <span className="erp-form-label">Status</span>
              <select
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm shadow-sm"
                value={activeFilter}
                onChange={(e) => setActiveFilter(e.target.value as "" | "true" | "false")}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
            <Button type="button" variant="outline" className="h-9" onClick={() => void loadUsers()} disabled={loading}>
              {loading ? "Loading…" : "Apply"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Loading users…
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No users match the current filters.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const isSelf = me?.id === u.id;
                    const rowBusy = busyId === u.id;
                    return (
                      <tr key={u.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 font-medium text-slate-900">{u.name}</td>
                        <td className="px-3 py-2 break-all text-slate-700">{u.email}</td>
                        <td className="px-3 py-2">
                          <select
                            className="h-8 rounded-md border border-slate-200 bg-white px-1.5 text-xs shadow-sm"
                            value={u.role}
                            disabled={rowBusy}
                            onChange={(e) => {
                              const next = e.target.value as UserRole;
                              if (next === u.role) return;
                              void patchUser(u.id, { role: next });
                            }}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABEL[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={
                              u.isActive
                                ? "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                                : "inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                            }
                          >
                            {u.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">{formatWhen(u.updatedAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={rowBusy || (isSelf && u.isActive)}
                              title={isSelf && u.isActive ? "You cannot deactivate your own account" : undefined}
                              onClick={() => void patchUser(u.id, { isActive: !u.isActive })}
                            >
                              {u.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={rowBusy || isSelf}
                              title={isSelf ? "Ask another admin to reset your password" : undefined}
                              onClick={() => openReset(u)}
                            >
                              <KeyRound className="mr-1 h-3.5 w-3.5" aria-hidden />
                              Reset
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {resetTarget ? (
        <ErpModal onClose={closeReset} backdropClassName="bg-slate-950/35" aria-labelledby="reset-password-title">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 id="reset-password-title" className="text-base font-semibold text-slate-900">
                  Reset password
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Set a new password for <span className="font-medium text-slate-800">{resetTarget.email}</span>.
                  Share it securely with the user.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                onClick={closeReset}
                aria-label="Close"
                disabled={resetting}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="grid gap-3 px-4 py-3">
              <label className="erp-form-field">
                <span className="erp-form-label">New password</span>
                <Input
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  className="h-9"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </label>
              <label className="erp-form-field">
                <span className="erp-form-label">Confirm password</span>
                <Input
                  type="password"
                  autoComplete="new-password"
                  className="h-9"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitReset();
                  }}
                />
              </label>
              {resetError ? <div className="text-xs text-rose-700">{resetError}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <Button type="button" variant="outline" className="h-9" onClick={closeReset} disabled={resetting}>
                Cancel
              </Button>
              <Button type="button" className="h-9" onClick={() => void submitReset()} disabled={resetting}>
                {resetting ? "Saving…" : "Reset password"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </div>
  );
}
