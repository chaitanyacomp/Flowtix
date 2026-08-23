-- Planned setup count for WO planning (purging RM). Existing rows default to 1 — no retroactive RM recalculation.
ALTER TABLE `WorkOrder`
  ADD COLUMN `plannedSetupCount` INT NOT NULL DEFAULT 1;

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD COLUMN `plannedSetupCount` INT NOT NULL DEFAULT 1;
