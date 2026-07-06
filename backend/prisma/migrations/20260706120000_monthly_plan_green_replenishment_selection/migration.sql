-- FT-PD-067: keep Customer/RS monthly production demand separate from selected FG Green Level replenishment.
ALTER TABLE `MonthlyProductionPlanLine`
  ADD COLUMN `customerProductionQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `greenReplenishmentQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;

ALTER TABLE `MonthlyProductionPlanRevisionLine`
  ADD COLUMN `customerProductionQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `greenReplenishmentQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;

-- Preserve legacy plan behavior for existing rows until they are edited under the new split UI.
UPDATE `MonthlyProductionPlanLine`
SET `customerProductionQty` = `plannedFgQty`
WHERE `customerProductionQty` = 0 AND `greenReplenishmentQty` = 0 AND `plannedFgQty` > 0;

UPDATE `MonthlyProductionPlanRevisionLine`
SET `customerProductionQty` = `plannedFgQty`
WHERE `customerProductionQty` = 0 AND `greenReplenishmentQty` = 0 AND `plannedFgQty` > 0;
