-- Zero Production Shift Report (valid OPEN shift with no output).
-- Additive only: reason enum + optional remarks on report versions.

ALTER TABLE `ShiftProductionReportVersion`
  ADD COLUMN `zeroProductionReason` ENUM(
    'NO_WORK_ORDER',
    'MACHINE_BREAKDOWN',
    'MATERIAL_UNAVAILABLE',
    'POWER_FAILURE',
    'PLANNED_MAINTENANCE',
    'OTHER'
  ) NULL,
  ADD COLUMN `zeroProductionRemarks` TEXT NULL;
