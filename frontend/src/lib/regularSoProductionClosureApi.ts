import { apiFetch } from "../services/api";
import type { RegularSoDemandCoverage } from "./regularSoProductionClosureUx";

export async function fetchRegularSoDemandCoverage(workOrderId: number): Promise<RegularSoDemandCoverage> {
  return apiFetch<RegularSoDemandCoverage>(`/api/production/work-orders/${workOrderId}/so-demand-coverage`);
}

export async function requestRegularEndProduction(
  workOrderId: number,
  body: { decision: "END_COVERED" | "END_SHORTAGE"; closureReason?: string | null },
): Promise<{
  outcome: string;
  decision: string;
  coverage: RegularSoDemandCoverage;
}> {
  return apiFetch(`/api/production/work-orders/${workOrderId}/end-production`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
