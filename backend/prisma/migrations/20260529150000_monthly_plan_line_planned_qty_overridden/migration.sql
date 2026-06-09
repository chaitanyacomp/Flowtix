-- Phase 8A: track explicit Store override of planned FG qty (not inferred from variance).
ALTER TABLE `MonthlyProductionPlanLine`
  ADD COLUMN `plannedQtyOverridden` BOOLEAN NOT NULL DEFAULT false;
