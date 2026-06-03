-- RM Wastage Note (MWN) + RM_WASTAGE stock transaction type (MySQL)

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
  'MATERIAL_WASTAGE_NOTE',
  'PRODUCTION_MATERIAL_REQUEST',
  'BOM',
  'MONTHLY_PRODUCTION_PLAN'
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
    'CUSTOMER_RETURN',
    'RM_WASTAGE'
  ) NOT NULL;

CREATE TABLE `MaterialWastageNote` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `workOrderId` INT NOT NULL,
  `productionMaterialRequestId` INT NULL,
  `fromLocationId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `qty` DECIMAL(18, 3) NOT NULL,
  `reason` ENUM(
    'PROCESS_LOSS',
    'MACHINE_SETTING',
    'SPILLAGE',
    'CONTAMINATION',
    'PURGING',
    'OTHER'
  ) NOT NULL,
  `remarks` TEXT NULL,
  `createdByUserId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `MaterialWastageNote_docNo_key`(`docNo`),
  INDEX `MaterialWastageNote_workOrderId_idx`(`workOrderId`),
  INDEX `MaterialWastageNote_productionMaterialRequestId_idx`(`productionMaterialRequestId`),
  INDEX `MaterialWastageNote_fromLocationId_idx`(`fromLocationId`),
  INDEX `MaterialWastageNote_itemId_idx`(`itemId`),
  INDEX `MaterialWastageNote_createdByUserId_idx`(`createdByUserId`),
  INDEX `MaterialWastageNote_createdAt_idx`(`createdAt`),
  INDEX `MaterialWastageNote_reason_idx`(`reason`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MaterialWastageNote` ADD CONSTRAINT `MaterialWastageNote_fromLocationId_fkey`
  FOREIGN KEY (`fromLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MaterialWastageNote` ADD CONSTRAINT `MaterialWastageNote_workOrderId_fkey`
  FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MaterialWastageNote` ADD CONSTRAINT `MaterialWastageNote_productionMaterialRequestId_fkey`
  FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MaterialWastageNote` ADD CONSTRAINT `MaterialWastageNote_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MaterialWastageNote` ADD CONSTRAINT `MaterialWastageNote_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
