export function positiveIntParam(value: string | null): number | null {
  const id = Number(value ?? 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function requestedMonthlyPlanId(params: URLSearchParams): number | null {
  return positiveIntParam(params.get("planId")) ?? positiveIntParam(params.get("monthlyPlanId"));
}
