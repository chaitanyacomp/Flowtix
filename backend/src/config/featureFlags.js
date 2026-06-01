/**
 * Central feature-flag reader (env-driven). Flags default OFF unless explicitly enabled.
 *
 * A flag is considered ON only when its env var is one of: "1", "true", "yes", "on"
 * (case-insensitive). Anything else (including unset) is OFF.
 */

function readBoolEnv(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const FEATURE_MONTHLY_PLANNING = "FEATURE_MONTHLY_PLANNING";
const FEATURE_PLANNING_DRIVEN_PROCUREMENT = "FEATURE_PLANNING_DRIVEN_PROCUREMENT";

/** Monthly Planning Workspace (Phase 1 foundation). Default OFF. */
function isMonthlyPlanningEnabled() {
  return readBoolEnv(FEATURE_MONTHLY_PLANNING, false);
}

/**
 * Phase 4C cutover guard. When ON, Monthly Planning is the only planning-driven
 * procurement source: the legacy/operational procurement-demand raise paths are blocked.
 * Default OFF — existing behavior unchanged.
 */
function isPlanningDrivenProcurementEnabled() {
  return readBoolEnv(FEATURE_PLANNING_DRIVEN_PROCUREMENT, false);
}

module.exports = {
  readBoolEnv,
  FEATURE_MONTHLY_PLANNING,
  FEATURE_PLANNING_DRIVEN_PROCUREMENT,
  isMonthlyPlanningEnabled,
  isPlanningDrivenProcurementEnabled,
};
