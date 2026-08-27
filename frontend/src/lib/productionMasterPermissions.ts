/**
 * Production master register mutation gate (Machines / Operators / Shifts / FG Standards).
 * ADMIN maintains masters; PRODUCTION_MANAGER is always read-only.
 * PRODUCTION may still mutate when backend WRITE_ROLES allow (existing shop-floor register upkeep).
 */
export function canWriteProductionMasters(role: string | null | undefined): boolean {
  const r = String(role ?? "").trim().toUpperCase();
  return r === "ADMIN" || r === "PRODUCTION";
}

/** Alias — shared gate for production master write actions. */
export const canWriteProductionMaster = canWriteProductionMasters;

export function isProductionManagerReadOnlyMasters(role: string | null | undefined): boolean {
  return String(role ?? "").trim().toUpperCase() === "PRODUCTION_MANAGER";
}
