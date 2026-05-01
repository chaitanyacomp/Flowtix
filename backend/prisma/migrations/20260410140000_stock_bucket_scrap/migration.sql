-- Extend StockBucket with SCRAP (QC rejected quantity → scrap bucket; ledger visibility).

ALTER TABLE `StockTransaction`
  MODIFY `stockBucket` ENUM('USABLE', 'QC_HOLD', 'REWORK', 'SCRAP') NOT NULL DEFAULT 'USABLE';

ALTER TABLE `QcEntry`
  MODIFY `rejectedStockBucket` ENUM('USABLE', 'QC_HOLD', 'REWORK', 'SCRAP') NULL;

ALTER TABLE `CustomerReturn`
  MODIFY `currentBucket` ENUM('USABLE', 'QC_HOLD', 'REWORK', 'SCRAP') NOT NULL;
