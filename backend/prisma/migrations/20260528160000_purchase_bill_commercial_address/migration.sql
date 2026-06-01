-- Purchase Bill commercial address snapshots (invoice-of-record)

ALTER TABLE `PurchaseBill` ADD COLUMN `supplierNameSnapshot` VARCHAR(256) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplierRegisteredGstinSnapshot` VARCHAR(15) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplierRegisteredAddressSnapshot` TEXT NOT NULL DEFAULT ('');
ALTER TABLE `PurchaseBill` ADD COLUMN `supplierRegisteredStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplierRegisteredStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '';

ALTER TABLE `PurchaseBill` ADD COLUMN `supplyLocationLabelSnapshot` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplyLocationAddressSnapshot` TEXT NOT NULL DEFAULT ('');
ALTER TABLE `PurchaseBill` ADD COLUMN `supplyLocationGstinSnapshot` VARCHAR(15) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplyLocationStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `supplyLocationStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '';

ALTER TABLE `PurchaseBill` ADD COLUMN `purchaseSourceStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `purchaseSourceStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `purchaseSourceSnapshot` VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE `PurchaseBill` ADD COLUMN `purchaseGstModeSnapshot` VARCHAR(32) NOT NULL DEFAULT '';
