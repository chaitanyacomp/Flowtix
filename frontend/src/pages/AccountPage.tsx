import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../hooks/useAuth";

function emailPrefix(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email.trim();
}

/** Short role context — statutory accounting stays in Tally for commercial roles. */
const ROLE_FOCUS_NOTES: Record<string, string> = {
  ADMIN: "Full ERP administration access.",
  SALES: "Customer, enquiry, quotation, sales order workflow. Read-only on billing/dispatch.",
  PRODUCTION: "Work order, production execution and rework approval workflow.",
  QC: "Quality checking, hold, rework and rejection workflow.",
  ACCOUNTS: "Sales/Purchase bill finalization and Tally export workflow. Accounting remains in Tally.",
  STORE: "Material planning, RM purchase, GRN, dispatch, stock and customer return operations.",
};

export function AccountPage() {
  const { user } = useAuth();

  const nameRaw = user?.name?.trim();
  const emailRaw = user?.email?.trim();
  const roleRaw = user?.role?.trim();

  const displayName =
    nameRaw && nameRaw.length > 0 ? nameRaw : emailRaw ? emailPrefix(emailRaw) : "User";
  const displayEmail = emailRaw && emailRaw.length > 0 ? emailRaw : "-";
  const displayRole = roleRaw && roleRaw.length > 0 ? roleRaw : "-";

  const focusNote =
    roleRaw && ROLE_FOCUS_NOTES[roleRaw] ? ROLE_FOCUS_NOTES[roleRaw] : null;

  return (
    <div className="mx-auto min-w-0 max-w-xl px-3 py-4 md:px-6">
      <div className="mb-4 border-b border-slate-200/90 pb-3">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Account</h1>
        <p className="mt-0.5 text-[12px] leading-snug text-slate-600">
          Signed-in identity — role is assigned by your administrator.
        </p>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 pb-3 pt-4">
          <CardTitle className="text-sm font-semibold text-slate-900">Profile</CardTitle>
          <p className="text-[11px] leading-snug text-slate-500">
            Details come from your login session. Role cannot be changed here.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 text-sm text-slate-800">
          <dl className="grid gap-3">
            <div className="grid gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Name</dt>
              <dd className="font-medium text-slate-900">{displayName}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Email</dt>
              <dd className="break-all text-slate-800">{displayEmail}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Role</dt>
              <dd>
                <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[13px] font-semibold tabular-nums text-slate-900">
                  {displayRole}
                </span>
              </dd>
            </div>
          </dl>

          {focusNote ? (
            <div className="rounded-md border border-slate-100 bg-slate-50/90 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Work focus</div>
              <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{focusNote}</p>
            </div>
          ) : null}

          <div className="border-t border-slate-100 pt-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Password</div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
              Password changes are handled by administrator.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
