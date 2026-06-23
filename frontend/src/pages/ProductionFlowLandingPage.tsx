import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { isStoreLikePlanningRole, noQtyAgreementListHref } from "../lib/noQtyStoreNavigation";

export function ProductionFlowLandingPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const role = user?.role ?? null;
  const storeLike = isStoreLikePlanningRole(role);

  return (
    <div className="mx-auto max-w-2xl space-y-3 rounded-md border border-slate-200 bg-white p-4 text-slate-800">
      <div className="text-base font-semibold text-slate-900">No production context selected</div>
      <div className="text-sm text-slate-600">
        Open Production, QC, Dispatch, or select a No Qty agreement to continue the workflow.
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => nav("/dashboard")}>
          Go to Dashboard
        </Button>
        <Button type="button" variant="outline" onClick={() => nav(noQtyAgreementListHref(role))}>
          {storeLike ? "Go to NO_QTY Execution" : "Go to NO_QTY Sales Orders"}
        </Button>
      </div>
    </div>
  );
}
