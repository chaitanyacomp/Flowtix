/**
 * Control Tower deep-link helpers — Dashboard → filtered Control Tower views.
 * Presentation / navigation only.
 */

export type ControlTowerFilterParams = {
  group?: string;
  status?: string;
  owner?: string;
  flow?: string;
  blockedOnly?: boolean;
  search?: string;
  focus?: "recovery" | "board" | "commercial" | "factory";
};

export function controlTowerHref(filters: ControlTowerFilterParams = {}): string {
  const q = new URLSearchParams();
  if (filters.group) q.set("group", filters.group);
  if (filters.status) q.set("status", filters.status);
  if (filters.owner) q.set("owner", filters.owner);
  if (filters.flow) q.set("flow", filters.flow);
  if (filters.blockedOnly) q.set("blockedOnly", "1");
  if (filters.search) q.set("q", filters.search);
  if (filters.focus) q.set("focus", filters.focus);
  const qs = q.toString();
  return qs ? `/control-tower?${qs}` : "/control-tower";
}

/** Parse Control Tower URL search params (browser Back restores these). */
export function parseControlTowerSearchParams(params: URLSearchParams): ControlTowerFilterParams {
  return {
    group: params.get("group")?.trim() || undefined,
    status: params.get("status")?.trim() || undefined,
    owner: params.get("owner")?.trim() || undefined,
    flow: params.get("flow")?.trim() || undefined,
    blockedOnly: params.get("blockedOnly") === "1" || params.get("blockedOnly") === "true",
    search: params.get("q")?.trim() || undefined,
    focus: (["recovery", "board", "commercial", "factory"].includes(String(params.get("focus") ?? ""))
      ? (params.get("focus") as ControlTowerFilterParams["focus"])
      : undefined),
  };
}

export function rowMatchesControlTowerFilters(
  row: { currentStatus?: string; currentOwner?: string; orderType?: string | null; documentNo?: string | null },
  filters: ControlTowerFilterParams,
): boolean {
  if (filters.status && String(row.currentStatus ?? "").toUpperCase() !== filters.status.toUpperCase()) {
    return false;
  }
  if (filters.owner && String(row.currentOwner ?? "").toUpperCase() !== filters.owner.toUpperCase()) {
    return false;
  }
  if (filters.flow && filters.flow !== "ALL") {
    const ot = String(row.orderType ?? "").toUpperCase();
    if (filters.flow === "NO_QTY" && ot !== "NO_QTY") return false;
    if (filters.flow === "REGULAR" && ot === "NO_QTY") return false;
  }
  if (filters.search) {
    const hay = `${row.documentNo ?? ""} ${row.currentStatus ?? ""} ${row.currentOwner ?? ""}`.toLowerCase();
    if (!hay.includes(filters.search.toLowerCase())) return false;
  }
  if (filters.blockedOnly) {
    const st = String(row.currentStatus ?? "").toUpperCase();
    if (!st.includes("HOLD") && !st.includes("BLOCK") && st !== "WAITING_RM") return false;
  }
  return true;
}
