-- Rework → Send to QC uses QC_PENDING (QC re-check queue), distinct from QC_HOLD (Hold for Checking).

ALTER TABLE `StockTransaction`
  MODIFY COLUMN `stockBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NOT NULL DEFAULT 'USABLE';

ALTER TABLE `QcEntry`
  MODIFY COLUMN `rejectedStockBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NULL;

ALTER TABLE `CustomerReturn`
  MODIFY COLUMN `currentBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NOT NULL;
