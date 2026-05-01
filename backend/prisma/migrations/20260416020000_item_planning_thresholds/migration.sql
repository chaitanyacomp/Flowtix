-- Add item-wise planning threshold settings for product-wise dashboard
ALTER TABLE `Item`
  ADD COLUMN `redThresholdPercent` DECIMAL(5, 2) NULL,
  ADD COLUMN `yellowThresholdPercent` DECIMAL(5, 2) NULL,
  ADD COLUMN `planningBufferPercent` DECIMAL(5, 2) NULL,
  ADD COLUMN `minimumStockQty` DECIMAL(18, 3) NULL,
  ADD COLUMN `reorderQty` DECIMAL(18, 3) NULL;

