import { useSearchParams } from "react-router-dom";

import { ERPBackNavigation, PageContainer, PageHeader, StickyWorkspaceHead } from "../../components/PageHeader";
import { PlanningStatusChip } from "../../components/erp/PlanningStatusChip";
import { StoreGreenLevelWoPlacementPanel } from "../../components/erp/store/StoreGreenLevelWoPlacementPanel";
import { buildGreenLevelWoPlacementHref } from "../../lib/greenLevelWoPlacementNavigation";

function greenLevelWoPlacementBackHref(from: string | null | undefined): string {
  if (from === "pending-actions") return "/pending-actions";
  if (from === "dashboard") return "/dashboard";
  if (from === "monthly-planning") return "/monthly-planning";
  return buildGreenLevelWoPlacementHref();
}

function greenLevelWoPlacementBackLabel(from: string | null | undefined): string {
  if (from === "pending-actions") return "Back to Pending Actions";
  if (from === "dashboard") return "Back to Dashboard";
  if (from === "monthly-planning") return "Back to Monthly Planning";
  return "Back to Dashboard";
}

export function GreenLevelWoPlacementPage() {
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");
  const planIdRaw = searchParams.get("planId");
  const planId = planIdRaw != null && planIdRaw.trim() !== "" ? Number(planIdRaw) : null;

  return (
    <PageContainer className="space-y-0 pb-6">
      <StickyWorkspaceHead
        lead={
          <ERPBackNavigation
            defaultTo={greenLevelWoPlacementBackHref(from)}
            defaultLabel={greenLevelWoPlacementBackLabel(from)}
          />
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <PageHeader
            title="Green Level WO Placement"
            subtitle="Store workspace — place WO · PMR · RM issue · release to production"
          />
          <PlanningStatusChip />
        </div>
      </StickyWorkspaceHead>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <StoreGreenLevelWoPlacementPanel planId={Number.isFinite(planId) ? planId : null} />
      </div>
    </PageContainer>
  );
}
