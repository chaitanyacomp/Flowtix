import { apiFetch } from "../services/api";

/** Resolve submitted PMR for Material Issue workspace (idempotent; UX only). */
export async function ensureSubmittedPmrForWorkOrderHandoff(workOrderId: number): Promise<{
  pmrId: number | null;
  pmrDocNo: string | null;
}> {
  const woId = Number(workOrderId);
  if (!Number.isFinite(woId) || woId <= 0) {
    return { pmrId: null, pmrDocNo: null };
  }
  try {
    const pmr = await apiFetch<{ id: number; docNo?: string | null }>(
      "/api/production-material-requests/ensure-for-work-order",
      { method: "POST", body: JSON.stringify({ workOrderId: woId }) },
    );
    const pmrId = Number(pmr?.id);
    return {
      pmrId: Number.isFinite(pmrId) && pmrId > 0 ? pmrId : null,
      pmrDocNo: pmr?.docNo?.trim() || null,
    };
  } catch {
    return { pmrId: null, pmrDocNo: null };
  }
}
