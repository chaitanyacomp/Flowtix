-- Phase 2B: Procurement planning — procured qty + PO traceability links

ALTER TABLE `MaterialRequirementLine`
  ADD COLUMN `procuredQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;

ALTER TABLE `MaterialRequirement`
  MODIFY `status` ENUM('DRAFT', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

CREATE TABLE `RmPoLineProcurementLink` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `rmPoLineId` INT NOT NULL,
  `materialRequirementLineId` INT NOT NULL,
  `allocatedQty` DECIMAL(18, 3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `RmPoLineProcurementLink_rmPoLineId_idx`(`rmPoLineId`),
  INDEX `RmPoLineProcurementLink_materialRequirementLineId_idx`(`materialRequirementLineId`),
  CONSTRAINT `RmPoLineProcurementLink_rmPoLineId_fkey`
    FOREIGN KEY (`rmPoLineId`) REFERENCES `RmPurchaseOrderLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `RmPoLineProcurementLink_materialRequirementLineId_fkey`
    FOREIGN KEY (`materialRequirementLineId`) REFERENCES `MaterialRequirementLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
