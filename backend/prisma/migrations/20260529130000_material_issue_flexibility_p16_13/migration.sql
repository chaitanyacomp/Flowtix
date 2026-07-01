-- P16-13: Material Issue flexibility — partial issue, waive, explicit production release.

ALTER TABLE `ProductionMaterialRequestLine`
  ADD COLUMN `waivedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0 AFTER `issuedQty`;

ALTER TABLE `WorkOrder`
  ADD COLUMN `materialReleasedToProductionAt` DATETIME(3) NULL AFTER `fgStockOverrideByUserId`,
  ADD COLUMN `materialReleasedByUserId` INT NULL AFTER `materialReleasedToProductionAt`;

ALTER TABLE `WorkOrder`
  ADD CONSTRAINT `WorkOrder_materialReleasedByUserId_fkey`
    FOREIGN KEY (`materialReleasedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionMaterialRequest`
  MODIFY `status` ENUM(
    'DRAFT',
    'REQUESTED',
    'PARTIALLY_ISSUED',
    'FULLY_ISSUED',
    'SHORT_ISSUE_ACCEPTED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'DRAFT';
