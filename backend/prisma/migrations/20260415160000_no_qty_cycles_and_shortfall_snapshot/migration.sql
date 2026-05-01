-- Add NO_QTY internal cycle management + per-cycle isolation columns.
-- Non-destructive: all new columns are nullable; legacy data continues to work as cycle 1 (implicit).

-- 1) SalesOrder: currentCycleId
ALTER TABLE `SalesOrder` ADD COLUMN `currentCycleId` INTEGER NULL;
CREATE INDEX `SalesOrder_currentCycleId_idx` ON `SalesOrder`(`currentCycleId`);

-- 2) SalesOrderCycle table
CREATE TABLE `SalesOrderCycle` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `salesOrderId` INTEGER NOT NULL,
  `cycleNo` INTEGER NOT NULL,
  `status` ENUM('ACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  `reopenReason` TEXT NULL,
  `reopenedByUserId` INTEGER NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `SalesOrderCycle_salesOrderId_cycleNo_key` (`salesOrderId`, `cycleNo`),
  INDEX `SalesOrderCycle_salesOrderId_idx` (`salesOrderId`),
  INDEX `SalesOrderCycle_status_idx` (`status`),
  CONSTRAINT `SalesOrderCycle_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SalesOrderCycle_reopenedByUserId_fkey` FOREIGN KEY (`reopenedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- FK SalesOrder.currentCycleId → SalesOrderCycle.id
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_currentCycleId_fkey` FOREIGN KEY (`currentCycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Per-cycle isolation columns
ALTER TABLE `WorkOrder` ADD COLUMN `cycleId` INTEGER NULL;
CREATE INDEX `WorkOrder_cycleId_idx` ON `WorkOrder`(`cycleId`);
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Dispatch` ADD COLUMN `cycleId` INTEGER NULL;
CREATE INDEX `Dispatch_cycleId_idx` ON `Dispatch`(`cycleId`);
ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RequirementSheet` ADD COLUMN `cycleId` INTEGER NULL;
CREATE INDEX `RequirementSheet_cycleId_idx` ON `RequirementSheet`(`cycleId`);
ALTER TABLE `RequirementSheet` ADD CONSTRAINT `RequirementSheet_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesBill` ADD COLUMN `cycleId` INTEGER NULL;
CREATE INDEX `SalesBill_cycleId_idx` ON `SalesBill`(`cycleId`);
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) RequirementSheet unique key must include cycleId
DROP INDEX `RequirementSheet_salesOrderId_periodKey_version_key` ON `RequirementSheet`;
CREATE UNIQUE INDEX `RequirementSheet_salesOrderId_cycleId_periodKey_version_key`
  ON `RequirementSheet`(`salesOrderId`, `cycleId`, `periodKey`, `version`);

-- 5) RequirementSheetLine: shortfall snapshot (filled on lock)
ALTER TABLE `RequirementSheetLine` ADD COLUMN `shortfallQtySnapshot` DECIMAL(18,3) NULL;

