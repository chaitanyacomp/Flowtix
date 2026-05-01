-- Add disposition-owned linkage for rework QC awaiting bucket.
ALTER TABLE `StockTransaction`
  ADD COLUMN `qcRejectedDispositionId` INT NULL;

-- Speeds up per-disposition QC_PENDING availability lookups.
CREATE INDEX `StockTransaction_qcRejectedDispositionId_stockBucket_itemId_idx`
  ON `StockTransaction` (`qcRejectedDispositionId`, `stockBucket`, `itemId`);

ALTER TABLE `StockTransaction`
  ADD CONSTRAINT `StockTransaction_qcRejectedDispositionId_fkey`
  FOREIGN KEY (`qcRejectedDispositionId`) REFERENCES `QcRejectedDisposition`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

