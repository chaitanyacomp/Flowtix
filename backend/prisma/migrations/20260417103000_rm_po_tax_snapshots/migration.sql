-- RM PO tax / export snapshots (unit, HSN, GST, amount per line; supplier state on header).
ALTER TABLE `RmPurchaseOrder`
  ADD COLUMN `supplierStateSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `supplierStateCodeSnapshot` VARCHAR(2) NULL;

ALTER TABLE `RmPurchaseOrderLine`
  ADD COLUMN `unit` VARCHAR(64) NULL,
  ADD COLUMN `hsn` VARCHAR(32) NULL,
  ADD COLUMN `gstRate` DECIMAL(5, 2) NULL,
  ADD COLUMN `amount` DECIMAL(18, 2) NULL;
