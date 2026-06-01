-- Store → Purchase handoff: PurchaseRequest (not RM PO)

ALTER TABLE `DocSequence` MODIFY `docType` ENUM(
  'SALES_ORDER',
  'WORK_ORDER',
  'PRODUCTION_ENTRY',
  'QC_ENTRY',
  'DISPATCH',
  'SALES_BILL',
  'REQUIREMENT_SHEET',
  'MATERIAL_REQUIREMENT',
  'PURCHASE_REQUEST',
  'BOM'
) NOT NULL;

CREATE TABLE `PurchaseRequest` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `status` ENUM('PENDING_PURCHASE', 'PARTIALLY_ORDERED', 'ORDERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PURCHASE',
  `remarks` TEXT NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `PurchaseRequest_docNo_key`(`docNo`),
  INDEX `PurchaseRequest_status_idx`(`status`),
  INDEX `PurchaseRequest_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PurchaseRequest_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseRequestLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `purchaseRequestId` INT NOT NULL,
  `rmItemId` INT NOT NULL,
  `requiredQty` DECIMAL(18, 3) NOT NULL,
  `availableQtySnapshot` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `netRequiredQty` DECIMAL(18, 3) NOT NULL,
  `orderedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `unitSnapshot` VARCHAR(64) NULL,
  UNIQUE INDEX `PurchaseRequestLine_purchaseRequestId_rmItemId_key`(`purchaseRequestId`, `rmItemId`),
  INDEX `PurchaseRequestLine_purchaseRequestId_idx`(`purchaseRequestId`),
  INDEX `PurchaseRequestLine_rmItemId_idx`(`rmItemId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PurchaseRequestLine_purchaseRequestId_fkey`
    FOREIGN KEY (`purchaseRequestId`) REFERENCES `PurchaseRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PurchaseRequestLine_rmItemId_fkey`
    FOREIGN KEY (`rmItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseRequestLineSourceLink` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `purchaseRequestLineId` INT NOT NULL,
  `materialRequirementLineId` INT NOT NULL,
  `allocatedQty` DECIMAL(18, 3) NOT NULL,
  INDEX `PurchaseRequestLineSourceLink_purchaseRequestLineId_idx`(`purchaseRequestLineId`),
  INDEX `PurchaseRequestLineSourceLink_materialRequirementLineId_idx`(`materialRequirementLineId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `PurchaseRequestLineSourceLink_purchaseRequestLineId_fkey`
    FOREIGN KEY (`purchaseRequestLineId`) REFERENCES `PurchaseRequestLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PurchaseRequestLineSourceLink_materialRequirementLineId_fkey`
    FOREIGN KEY (`materialRequirementLineId`) REFERENCES `MaterialRequirementLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RmPoLineProcurementLink`
  MODIFY `materialRequirementLineId` INT NULL,
  ADD COLUMN `purchaseRequestLineId` INT NULL,
  ADD INDEX `RmPoLineProcurementLink_purchaseRequestLineId_idx`(`purchaseRequestLineId`),
  ADD CONSTRAINT `RmPoLineProcurementLink_purchaseRequestLineId_fkey`
    FOREIGN KEY (`purchaseRequestLineId`) REFERENCES `PurchaseRequestLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
