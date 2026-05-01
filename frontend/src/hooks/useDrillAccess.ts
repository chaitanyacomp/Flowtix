import * as React from "react";
import { useAuth } from "./useAuth";
import {
  type DrillTargetKey,
  DRILL_TARGET_ROLES,
  roleMayUseDrillTarget,
} from "../lib/drillAccess";

/** Whether the current user may use a drill to the given destination (nav-aligned roles). */
export function useDrillActivable(target: DrillTargetKey): boolean {
  const role = useAuth().user?.role;
  return roleMayUseDrillTarget(role, target);
}

/** Memoized map of all drill targets — handy for dashboards with multiple drill types. */
export function useDrillAccessMap(): Record<DrillTargetKey, boolean> {
  const role = useAuth().user?.role;
  return React.useMemo(() => {
    const keys = Object.keys(DRILL_TARGET_ROLES) as DrillTargetKey[];
    return Object.fromEntries(keys.map((k) => [k, roleMayUseDrillTarget(role, k)])) as Record<
      DrillTargetKey,
      boolean
    >;
  }, [role]);
}
