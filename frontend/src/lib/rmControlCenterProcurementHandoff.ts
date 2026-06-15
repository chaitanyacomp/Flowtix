/** Resolve procurement MR context for RM Control Center (Regular SO + MPRS). */

export type CaseProcurementMrContext = {
  materialRequirementId: number;
  sourceType: string;
  docNo: string | null;
  status: string | null;
};

type OpenMrLine = {
  materialRequirementId?: number | null;
  sourceType?: string | null;
  materialRequirementDocNo?: string | null;
  workOrderId?: number | null;
  status?: string | null;
};

export function resolveCaseProcurementMr(input: {
  woCaseMr?: {
    id?: number | null;
    sourceType?: string | null;
    docNo?: string | null;
    status?: string | null;
  } | null;
  boundMaterialRequirement?: {
    id?: number | null;
    sourceType?: string | null;
    docNo?: string | null;
    status?: string | null;
  } | null;
  queueRowMrId?: number | null;
  openMrLines?: OpenMrLine[];
  workOrderId?: number | null;
  planningDrivenProcurement?: boolean;
}): CaseProcurementMrContext | null {
  const woMr = input.woCaseMr;
  if (woMr?.id != null && woMr.id > 0) {
    return {
      materialRequirementId: woMr.id,
      sourceType: String(woMr.sourceType ?? "SALES_ORDER"),
      docNo: woMr.docNo ?? null,
      status: woMr.status ?? null,
    };
  }

  const bound = input.boundMaterialRequirement;
  if (bound?.id != null && bound.id > 0) {
    return {
      materialRequirementId: bound.id,
      sourceType: String(bound.sourceType ?? "MONTHLY_PLAN"),
      docNo: bound.docNo ?? null,
      status: bound.status ?? null,
    };
  }

  const lines = input.openMrLines ?? [];
  const woId = input.workOrderId ?? null;
  const monthlyPlanLine =
    lines.find(
      (ln) =>
        ln.sourceType === "MONTHLY_PLAN" &&
        ln.materialRequirementId != null &&
        ln.materialRequirementId > 0 &&
        (woId == null || ln.workOrderId == null || ln.workOrderId === woId),
    ) ??
    lines.find((ln) => ln.sourceType === "MONTHLY_PLAN" && ln.materialRequirementId != null && ln.materialRequirementId > 0);

  if (monthlyPlanLine?.materialRequirementId) {
    return {
      materialRequirementId: monthlyPlanLine.materialRequirementId,
      sourceType: "MONTHLY_PLAN",
      docNo: monthlyPlanLine.materialRequirementDocNo ?? null,
      status: monthlyPlanLine.status ?? null,
    };
  }

  const queueMrId = input.queueRowMrId ?? null;
  if (queueMrId != null && queueMrId > 0) {
    const fromQueue = lines.find((ln) => ln.materialRequirementId === queueMrId);
    return {
      materialRequirementId: queueMrId,
      sourceType: fromQueue?.sourceType ?? (input.planningDrivenProcurement ? "MONTHLY_PLAN" : "SALES_ORDER"),
      docNo: fromQueue?.materialRequirementDocNo ?? null,
      status: fromQueue?.status ?? null,
    };
  }

  return null;
}

/** MPRS / monthly-plan MRs use Procurement Workspace navigation instead of direct PR API. */
export function prefersProcurementWorkspaceNavigation(
  ctx: CaseProcurementMrContext | null,
  opts?: { planningDrivenProcurement?: boolean; woCaseMrId?: number | null },
): boolean {
  if (!ctx) return false;
  if (ctx.sourceType === "MONTHLY_PLAN") return true;
  if (opts?.planningDrivenProcurement && !opts.woCaseMrId) return true;
  return false;
}
