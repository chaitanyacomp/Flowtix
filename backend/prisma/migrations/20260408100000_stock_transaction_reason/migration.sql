-- Optional audit text for manual stock corrections. Legacy rows remain NULL.
ALTER TABLE `StockTransaction` ADD COLUMN `reason` TEXT NULL;
