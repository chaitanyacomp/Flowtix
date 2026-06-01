-- Phase 3D — Material Return Note (MRN): production → store RM return

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

ALTER TABLE `ProductionMaterialRequestLine`
  ADD COLUMN `returnedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;

CREATE TABLE `MaterialReturnNote` (
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

CREATE TABLE `MaterialReturnLine` (
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

ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_fromLocationId_fkey` FOREIGN KEY (`fromLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_toLocationId_fkey` FOREIGN KEY (`toLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_productionMaterialRequestId_fkey` FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnNote` ADD CONSTRAINT `MaterialReturnNote_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnLine` ADD CONSTRAINT `MaterialReturnLine_materialReturnNoteId_fkey` FOREIGN KEY (`materialReturnNoteId`) REFERENCES `MaterialReturnNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MaterialReturnLine` ADD CONSTRAINT `MaterialReturnLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
