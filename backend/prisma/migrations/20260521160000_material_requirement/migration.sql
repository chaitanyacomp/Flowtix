-- Material Planning Phase 1: Material Requirement drafts from quotation / sales order

ALTER TABLE `DocSequence` MODIFY `docType` ENUM(
  'SALES_ORDER',
  'WORK_ORDER',
  'PRODUCTION_ENTRY',
  'QC_ENTRY',
  'DISPATCH',
  'SALES_BILL',
  'REQUIREMENT_SHEET',
  'MATERIAL_REQUIREMENT',
  'BOM'
) NOT NULL;

CREATE TABLE `MaterialRequirement` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `status` ENUM('DRAFT') NOT NULL DEFAULT 'DRAFT',
  `sourceType` ENUM('QUOTATION', 'SALES_ORDER') NOT NULL,
  `quotationId` INT NULL,
  `salesOrderId` INT NULL,
  `createdByUserId` INT NULL,
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `MaterialRequirement_docNo_key`(`docNo`),
  INDEX `MaterialRequirement_quotationId_idx`(`quotationId`),
  INDEX `MaterialRequirement_salesOrderId_idx`(`salesOrderId`),
  INDEX `MaterialRequirement_status_idx`(`status`),
  INDEX `MaterialRequirement_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MaterialRequirementLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `materialRequirementId` INT NOT NULL,
  `rmItemId` INT NOT NULL,
  `requiredQty` DECIMAL(18, 3) NOT NULL,
  `shortageQty` DECIMAL(18, 3) NOT NULL,
  `availableQtySnapshot` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `unitSnapshot` VARCHAR(64) NULL,
  UNIQUE INDEX `MaterialRequirementLine_materialRequirementId_rmItemId_key`(`materialRequirementId`, `rmItemId`),
  INDEX `MaterialRequirementLine_materialRequirementId_idx`(`materialRequirementId`),
  INDEX `MaterialRequirementLine_rmItemId_idx`(`rmItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MaterialRequirement`
  ADD CONSTRAINT `MaterialRequirement_quotationId_fkey`
    FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `MaterialRequirement_salesOrderId_fkey`
    FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `MaterialRequirement_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MaterialRequirementLine`
  ADD CONSTRAINT `MaterialRequirementLine_materialRequirementId_fkey`
    FOREIGN KEY (`materialRequirementId`) REFERENCES `MaterialRequirement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `MaterialRequirementLine_rmItemId_fkey`
    FOREIGN KEY (`rmItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
