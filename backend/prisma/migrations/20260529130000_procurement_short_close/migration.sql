-- Procurement Short Close (FT-PD-066) — additive qty + audit trail only.
-- Does not change requiredQty, stock, GRN, or PMR tables.

ALTER TABLE `MaterialRequirementLine`
  ADD COLUMN `shortClosedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0 AFTER `procuredQty`;

ALTER TABLE `PurchaseRequestLine`
  ADD COLUMN `shortClosedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0 AFTER `orderedQty`;

ALTER TABLE `RmPurchaseOrderLine`
  ADD COLUMN `shortClosedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0 AFTER `amount`;

CREATE TABLE `ProcurementShortCloseEvent` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rmPoId` INTEGER NOT NULL,
  `rmPoLineId` INTEGER NOT NULL,
  `shortClosedQty` DECIMAL(18, 3) NOT NULL,
  `reason` VARCHAR(64) NOT NULL,
  `remarks` TEXT NULL,
  `actorUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ProcurementShortCloseEvent_rmPoId_idx`(`rmPoId`),
  INDEX `ProcurementShortCloseEvent_rmPoLineId_idx`(`rmPoLineId`),
  INDEX `ProcurementShortCloseEvent_actorUserId_idx`(`actorUserId`),
  INDEX `ProcurementShortCloseEvent_createdAt_idx`(`createdAt`),
  CONSTRAINT `ProcurementShortCloseEvent_rmPoId_fkey` FOREIGN KEY (`rmPoId`) REFERENCES `RmPurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProcurementShortCloseEvent_rmPoLineId_fkey` FOREIGN KEY (`rmPoLineId`) REFERENCES `RmPurchaseOrderLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProcurementShortCloseEvent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
