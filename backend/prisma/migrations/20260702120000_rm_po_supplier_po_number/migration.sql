ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierPoNumber` VARCHAR(100) NULL;

UPDATE `RmPurchaseOrder`
SET `supplierPoNumber` = CONCAT('LEGACY-RMPO-', `id`)
WHERE `supplierPoNumber` IS NULL OR TRIM(`supplierPoNumber`) = '';

ALTER TABLE `RmPurchaseOrder` MODIFY COLUMN `supplierPoNumber` VARCHAR(100) NOT NULL;
