-- Opening Stock module:
-- - Add OPENING to StockTransaction.transactionType
-- - Create OpeningStockEntry (draft → approve creates StockTransaction.OPENING)

ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
    'OPENING',
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'SCRAP',
    'ADJUSTMENT',
    'BUCKET_TRANSFER',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL',
    'CUSTOMER_RETURN'
  ) NOT NULL;

CREATE TABLE `OpeningStockEntry` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `itemId` INTEGER NOT NULL,
  `stockBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NOT NULL DEFAULT 'USABLE',
  `openingQty` DECIMAL(18, 3) NOT NULL,
  `status` ENUM('DRAFT', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `approvedAt` DATETIME(3) NULL,
  `createdByUserId` INTEGER NULL,
  `approvedByUserId` INTEGER NULL,

  INDEX `OpeningStockEntry_itemId_idx`(`itemId`),
  INDEX `OpeningStockEntry_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `OpeningStockEntry_approvedAt_idx`(`approvedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `OpeningStockEntry`
  ADD CONSTRAINT `OpeningStockEntry_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OpeningStockEntry`
  ADD CONSTRAINT `OpeningStockEntry_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `OpeningStockEntry`
  ADD CONSTRAINT `OpeningStockEntry_approvedByUserId_fkey` FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

