-- Classify rejected production QC quantity into a stock bucket (ledger state).

ALTER TABLE `QcEntry`
  ADD COLUMN `rejectedStockBucket` ENUM('USABLE', 'QC_HOLD', 'REWORK') NULL;
