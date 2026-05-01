-- Regular SO: customer commitment vs planned production qty (buffer).
ALTER TABLE `SalesOrderLine` ADD COLUMN `customerPoQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;
ALTER TABLE `SalesOrderLine` ADD COLUMN `bufferPercent` DECIMAL(18, 2) NOT NULL DEFAULT 0;

UPDATE `SalesOrderLine` SET `customerPoQty` = `qty`, `bufferPercent` = 0;

ALTER TABLE `AppSetting` ADD COLUMN `maxRegularSoBufferPercent` DECIMAL(18, 2) NOT NULL DEFAULT 10;
