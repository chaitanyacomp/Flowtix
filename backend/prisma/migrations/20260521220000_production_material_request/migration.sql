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
  'MATERIAL_RETURN_NOTE',
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
  `returnedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
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

-- Phase 3D — PMR line returnedQty (moved from 20260520120000_material_return_note; table did not exist yet).
-- Idempotent for DBs that already received returnedQty via the original material_return_note ALTER.
SET @pmr_returned_col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ProductionMaterialRequestLine'
    AND COLUMN_NAME = 'returnedQty'
);
SET @sql_pmr_returned = IF(
  @pmr_returned_col = 0,
  'ALTER TABLE `ProductionMaterialRequestLine` ADD COLUMN `returnedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt_pmr_returned FROM @sql_pmr_returned;
EXECUTE stmt_pmr_returned;
DEALLOCATE PREPARE stmt_pmr_returned;

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

-- From 20260520120000_material_return_note (deferred until Location + PMR exist).
CREATE TABLE IF NOT EXISTS `MaterialReturnNote` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `fromLocationId` INT NOT NULL,
  `toLocationId` INT NOT NULL,
  `workOrderId` INT NULL,
  `productionMaterialRequestId` INT NULL,
  `remarks` TEXT NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MaterialReturnNote_docNo_key`(`docNo`),
  INDEX `MaterialReturnNote_fromLocationId_idx`(`fromLocationId`),
  INDEX `MaterialReturnNote_toLocationId_idx`(`toLocationId`),
  INDEX `MaterialReturnNote_workOrderId_idx`(`workOrderId`),
  INDEX `MaterialReturnNote_productionMaterialRequestId_idx`(`productionMaterialRequestId`),
  INDEX `MaterialReturnNote_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MaterialReturnLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `materialReturnNoteId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `returnQty` DECIMAL(18, 3) NOT NULL,
  `remarks` TEXT NULL,
  `unitSnapshot` VARCHAR(64) NULL,

  INDEX `MaterialReturnLine_materialReturnNoteId_idx`(`materialReturnNoteId`),
  INDEX `MaterialReturnLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @mrn_from_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnNote'
    AND CONSTRAINT_NAME = 'MaterialReturnNote_fromLocationId_fkey'
);
SET @sql_mrn_from = IF(
  @mrn_from_fk = 0,
  'ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_fromLocationId_fkey` FOREIGN KEY (`fromLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrn_from FROM @sql_mrn_from;
EXECUTE stmt_mrn_from;
DEALLOCATE PREPARE stmt_mrn_from;

SET @mrn_to_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnNote'
    AND CONSTRAINT_NAME = 'MaterialReturnNote_toLocationId_fkey'
);
SET @sql_mrn_to = IF(
  @mrn_to_fk = 0,
  'ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_toLocationId_fkey` FOREIGN KEY (`toLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrn_to FROM @sql_mrn_to;
EXECUTE stmt_mrn_to;
DEALLOCATE PREPARE stmt_mrn_to;

SET @mrn_wo_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnNote'
    AND CONSTRAINT_NAME = 'MaterialReturnNote_workOrderId_fkey'
);
SET @sql_mrn_wo = IF(
  @mrn_wo_fk = 0,
  'ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrn_wo FROM @sql_mrn_wo;
EXECUTE stmt_mrn_wo;
DEALLOCATE PREPARE stmt_mrn_wo;

SET @mrn_pmr_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnNote'
    AND CONSTRAINT_NAME = 'MaterialReturnNote_productionMaterialRequestId_fkey'
);
SET @sql_mrn_pmr = IF(
  @mrn_pmr_fk = 0,
  'ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_productionMaterialRequestId_fkey` FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrn_pmr FROM @sql_mrn_pmr;
EXECUTE stmt_mrn_pmr;
DEALLOCATE PREPARE stmt_mrn_pmr;

SET @mrn_user_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnNote'
    AND CONSTRAINT_NAME = 'MaterialReturnNote_createdByUserId_fkey'
);
SET @sql_mrn_user = IF(
  @mrn_user_fk = 0,
  'ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrn_user FROM @sql_mrn_user;
EXECUTE stmt_mrn_user;
DEALLOCATE PREPARE stmt_mrn_user;

SET @mrl_note_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnLine'
    AND CONSTRAINT_NAME = 'MaterialReturnLine_materialReturnNoteId_fkey'
);
SET @sql_mrl_note = IF(
  @mrl_note_fk = 0,
  'ALTER TABLE `MaterialReturnLine` ADD CONSTRAINT `MaterialReturnLine_materialReturnNoteId_fkey` FOREIGN KEY (`materialReturnNoteId`) REFERENCES `MaterialReturnNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrl_note FROM @sql_mrl_note;
EXECUTE stmt_mrl_note;
DEALLOCATE PREPARE stmt_mrl_note;

SET @mrl_item_fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MaterialReturnLine'
    AND CONSTRAINT_NAME = 'MaterialReturnLine_itemId_fkey'
);
SET @sql_mrl_item = IF(
  @mrl_item_fk = 0,
  'ALTER TABLE `MaterialReturnLine` ADD CONSTRAINT `MaterialReturnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt_mrl_item FROM @sql_mrl_item;
EXECUTE stmt_mrl_item;
DEALLOCATE PREPARE stmt_mrl_item;
