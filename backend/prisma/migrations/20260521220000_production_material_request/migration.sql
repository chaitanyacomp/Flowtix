-- Phase 3B: Production Material Request (PMR) + link to Material Issue Note

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
  'MATERIAL_ISSUE_NOTE',
  'PRODUCTION_MATERIAL_REQUEST',
  'BOM'
) NOT NULL;

CREATE TABLE IF NOT EXISTS `ProductionMaterialRequest` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `workOrderId` INT NOT NULL,
  `status` ENUM('DRAFT', 'REQUESTED', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `remarks` TEXT NULL,
  `requestedAt` DATETIME(3) NULL,
  `requestedByUserId` INT NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ProductionMaterialRequest_docNo_key`(`docNo`),
  INDEX `ProductionMaterialRequest_workOrderId_idx`(`workOrderId`),
  INDEX `ProductionMaterialRequest_status_idx`(`status`),
  INDEX `ProductionMaterialRequest_requestedByUserId_idx`(`requestedByUserId`),
  INDEX `ProductionMaterialRequest_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ProductionMaterialRequest_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ProductionMaterialRequest_requestedByUserId_fkey`
    FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ProductionMaterialRequest_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProductionMaterialRequestLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productionMaterialRequestId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `requiredQty` DECIMAL(18, 3) NOT NULL,
  `issuedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `unitSnapshot` VARCHAR(64) NULL,
  UNIQUE INDEX `PmrLine_pmrId_itemId_key`(`productionMaterialRequestId`, `itemId`),
  INDEX `ProductionMaterialRequestLine_productionMaterialRequestId_idx`(`productionMaterialRequestId`),
  INDEX `ProductionMaterialRequestLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ProductionMaterialRequestLine_productionMaterialRequestId_fkey`
    FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductionMaterialRequestLine_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Add MIN → PMR link if missing (idempotent for partial failed runs)
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialIssueNote'
    AND COLUMN_NAME = 'productionMaterialRequestId'
);
SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE `MaterialIssueNote` ADD COLUMN `productionMaterialRequestId` INT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialIssueNote'
    AND INDEX_NAME = 'MaterialIssueNote_productionMaterialRequestId_idx'
);
SET @sql2 = IF(
  @idx_exists = 0,
  'ALTER TABLE `MaterialIssueNote` ADD INDEX `MaterialIssueNote_productionMaterialRequestId_idx`(`productionMaterialRequestId`)',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @fk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialIssueNote'
    AND CONSTRAINT_NAME = 'MaterialIssueNote_productionMaterialRequestId_fkey'
);
SET @sql3 = IF(
  @fk_exists = 0,
  'ALTER TABLE `MaterialIssueNote` ADD CONSTRAINT `MaterialIssueNote_productionMaterialRequestId_fkey` FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
