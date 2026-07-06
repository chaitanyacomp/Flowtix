/** Store-owned Green Level WO placement workspace — routing helpers (presentation only). */

export function buildGreenLevelWoPlacementHref(opts?: {
  planId?: number | null;
  from?: string | null;
  focus?: string | null;
}): string {
  const q = new URLSearchParams();
  if (opts?.from) q.set("from", opts.from);
  if (opts?.focus) q.set("focus", opts.focus);
  if (opts?.planId != null && Number(opts.planId) > 0) q.set("planId", String(opts.planId));
  const s = q.toString();
  return s ? `/store/green-level-wo?${s}` : "/store/green-level-wo";
}

export function isGreenLevelWorkOrderSource(sourceType?: string | null): boolean {
  return String(sourceType ?? "").toUpperCase() === "GREEN_LEVEL_REPLENISHMENT";
}

const GREEN_LEVEL_PENDING_ACTION_RE =
  /^(Create Green Level WO|Green Level Replenishment WO Pending)$/i;

/** Rewrite legacy Production-workspace GL links to Store placement workspace. */
export function resolveGreenLevelPendingActionHref(href: string, action?: string | null): string {
  const label = String(action ?? "").trim();
  if (!GREEN_LEVEL_PENDING_ACTION_RE.test(label)) return href;
  try {
    const url = new URL(href, "http://erp.local");
    if (url.pathname === "/store/green-level-wo") return href;
    const isLegacyProductionGlLink =
      url.pathname === "/work-orders" &&
      (url.searchParams.get("focus") === "green-level-wo" || label.length > 0);
    if (!isLegacyProductionGlLink && url.pathname !== "/dashboard") return href;
    const planIdRaw = url.searchParams.get("planId");
    const planId = planIdRaw != null && planIdRaw.trim() !== "" ? Number(planIdRaw) : null;
    return buildGreenLevelWoPlacementHref({
      from: url.searchParams.get("from") ?? "pending-actions",
      planId: Number.isFinite(planId) ? planId : null,
    });
  } catch {
    return buildGreenLevelWoPlacementHref({ from: "pending-actions" });
  }
}
