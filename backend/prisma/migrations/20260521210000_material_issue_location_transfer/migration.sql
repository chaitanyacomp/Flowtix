-- Phase 3A: Material Issue Note (MIN) + LOCATION_TRANSFER stock txn type

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
  'BOM'
) NOT NULL;

ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
    'OPENING',
    'OPENING_REVERSAL',
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'SCRAP',
    'ADJUSTMENT',
    'BUCKET_TRANSFER',
    'LOCATION_TRANSFER',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL',
    'CUSTOMER_RETURN'
  ) NOT NULL;

CREATE TABLE `MaterialIssueNote` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `fromLocationId` INT NOT NULL,
  `toLocationId` INT NOT NULL,
  `workOrderId` INT NULL,
  `remarks` TEXT NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `MaterialIssueNote_docNo_key`(`docNo`),
  INDEX `MaterialIssueNote_fromLocationId_idx`(`fromLocationId`),
  INDEX `MaterialIssueNote_toLocationId_idx`(`toLocationId`),
  INDEX `MaterialIssueNote_workOrderId_idx`(`workOrderId`),
  INDEX `MaterialIssueNote_createdByUserId_idx`(`createdByUserId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MaterialIssueNote_fromLocationId_fkey`
    FOREIGN KEY (`fromLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MaterialIssueNote_toLocationId_fkey`
    FOREIGN KEY (`toLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `MaterialIssueNote_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `MaterialIssueNote_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MaterialIssueLine` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `materialIssueNoteId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `issueQty` DECIMAL(18, 3) NOT NULL,
  `unitSnapshot` VARCHAR(64) NULL,
  INDEX `MaterialIssueLine_materialIssueNoteId_idx`(`materialIssueNoteId`),
  INDEX `MaterialIssueLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `MaterialIssueLine_materialIssueNoteId_fkey`
    FOREIGN KEY (`materialIssueNoteId`) REFERENCES `MaterialIssueNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MaterialIssueLine_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
