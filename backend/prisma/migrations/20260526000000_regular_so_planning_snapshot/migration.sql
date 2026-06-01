-- Additive snapshot tables for regular SO production planning quantity architecture.
-- This migration intentionally does not alter SalesOrderLine.qty.

CREATE TABLE `RegularSoPlanningSnapshot` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `salesOrderId` INT NOT NULL,
  `bufferPercent` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `createdByUserId` INT NULL,
  `updatedByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `RegularSoPlanningSnapshot_salesOrderId_key`(`salesOrderId`),
  INDEX `RegularSoPlanningSnapshot_createdByUserId_idx`(`createdByUserId`),
  INDEX `RegularSoPlanningSnapshot_updatedByUserId_idx`(`updatedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RegularSoPlanningSnapshotLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `snapshotId` INT NOT NULL,
  `salesOrderId` INT NOT NULL,
  `salesOrderLineId` INT NOT NULL,
  `customerCommittedQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `productionBufferPercent` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `productionBufferQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `plannedProductionQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `fgStockAdjustmentQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `rmPlanningQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `RegularSoPlanningSnapshotLine_salesOrderLineId_key`(`salesOrderLineId`),
  INDEX `RegularSoPlanningSnapshotLine_snapshotId_idx`(`snapshotId`),
  INDEX `RegularSoPlanningSnapshotLine_salesOrderId_idx`(`salesOrderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD CONSTRAINT `RegularSoPlanningSnapshot_salesOrderId_fkey`
  FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD CONSTRAINT `RegularSoPlanningSnapshot_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD CONSTRAINT `RegularSoPlanningSnapshot_updatedByUserId_fkey`
  FOREIGN KEY (`updatedByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RegularSoPlanningSnapshotLine`
  ADD CONSTRAINT `RegularSoPlanningSnapshotLine_snapshotId_fkey`
  FOREIGN KEY (`snapshotId`) REFERENCES `RegularSoPlanningSnapshot`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RegularSoPlanningSnapshotLine`
  ADD CONSTRAINT `RegularSoPlanningSnapshotLine_salesOrderId_fkey`
  FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RegularSoPlanningSnapshotLine`
  ADD CONSTRAINT `RegularSoPlanningSnapshotLine_salesOrderLineId_fkey`
  FOREIGN KEY (`salesOrderLineId`) REFERENCES `SalesOrderLine`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
