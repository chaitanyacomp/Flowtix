-- Customer Return module + stock bucket classification.

-- 1) Add stock bucket to StockTransaction (default USABLE)
ALTER TABLE `StockTransaction`
  ADD COLUMN `stockBucket` ENUM('USABLE', 'QC_HOLD', 'REWORK') NOT NULL DEFAULT 'USABLE';

UPDATE `StockTransaction` SET `stockBucket` = 'USABLE' WHERE `stockBucket` IS NULL;

CREATE INDEX `StockTransaction_stockBucket_itemId_idx` ON `StockTransaction`(`stockBucket`, `itemId`);

-- 2) Extend StockTransaction.transactionType enum to include CUSTOMER_RETURN
ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'ADJUSTMENT',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL',
    'CUSTOMER_RETURN'
  ) NOT NULL;

-- 3) Create CustomerReturn table
CREATE TABLE `CustomerReturn` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `customerId` INTEGER NOT NULL,
  `dispatchId` INTEGER NOT NULL,
  `salesOrderId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `returnedQty` DECIMAL(18, 3) NOT NULL,
  `reason` TEXT NOT NULL,
  `returnDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `disposition` ENUM('QC_HOLD', 'REWORK', 'SCRAP', 'TO_STOCK') NOT NULL,
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reversedAt` DATETIME(3) NULL,

  INDEX `CustomerReturn_customerId_returnDate_idx`(`customerId`, `returnDate`),
  INDEX `CustomerReturn_dispatchId_idx`(`dispatchId`),
  INDEX `CustomerReturn_salesOrderId_itemId_idx`(`salesOrderId`, `itemId`),
  INDEX `CustomerReturn_reversedAt_idx`(`reversedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerReturn`
  ADD CONSTRAINT `CustomerReturn_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturn`
  ADD CONSTRAINT `CustomerReturn_dispatchId_fkey` FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturn`
  ADD CONSTRAINT `CustomerReturn_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CustomerReturn`
  ADD CONSTRAINT `CustomerReturn_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

