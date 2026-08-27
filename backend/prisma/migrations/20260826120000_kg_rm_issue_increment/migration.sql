-- Kg RM issue increment: Item.issueIncrement + PMR/MIN rounding snapshots.
-- Existing Kg RM items backfilled to 1 Kg. Non-Kg / non-RM remain NULL (exact issue).

ALTER TABLE `Item`
  ADD COLUMN `issueIncrement` DECIMAL(18, 6) NULL;

UPDATE `Item` `i`
LEFT JOIN `Unit` `u` ON `u`.`id` = `i`.`unitId`
SET `i`.`issueIncrement` = 1
WHERE `i`.`itemType` = 'RM'
  AND (
    LOWER(TRIM(COALESCE(`u`.`unitCode`, ''))) IN ('kg', 'kilogram', 'kilograms')
    OR LOWER(TRIM(COALESCE(`u`.`unitName`, ''))) IN ('kg', 'kilogram', 'kilograms')
    OR LOWER(TRIM(COALESCE(`i`.`unit`, ''))) IN ('kg', 'kilogram', 'kilograms')
  );

ALTER TABLE `ProductionMaterialRequestLine`
  ADD COLUMN `issueIncrementSnapshot` DECIMAL(18, 6) NULL,
  ADD COLUMN `roundedIssueTargetQty` DECIMAL(18, 6) NULL,
  ADD COLUMN `productionRmQty` DECIMAL(18, 6) NULL,
  ADD COLUMN `purgingRmQty` DECIMAL(18, 6) NULL;

ALTER TABLE `MaterialIssueLine`
  ADD COLUMN `issueIncrementSnapshot` DECIMAL(18, 6) NULL,
  ADD COLUMN `plannedRequiredQtySnapshot` DECIMAL(18, 6) NULL,
  ADD COLUMN `roundedIssueTargetQty` DECIMAL(18, 6) NULL,
  ADD COLUMN `roundingExcessQty` DECIMAL(18, 6) NULL;
