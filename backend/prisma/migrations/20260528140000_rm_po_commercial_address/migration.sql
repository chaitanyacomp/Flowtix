-- RM PO + GRN commercial address foundation (supplier supply location)

ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierLocationId` INTEGER NULL;

ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierNameSnapshot` VARCHAR(256) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierRegisteredGstinSnapshot` VARCHAR(15) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierRegisteredAddressSnapshot` TEXT NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierRegisteredStateNameSnapshot` VARCHAR(128) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplierRegisteredStateCodeSnapshot` VARCHAR(2) NULL;

ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplyLocationLabelSnapshot` VARCHAR(128) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplyLocationAddressSnapshot` TEXT NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplyLocationGstinSnapshot` VARCHAR(15) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplyLocationStateNameSnapshot` VARCHAR(128) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `supplyLocationStateCodeSnapshot` VARCHAR(2) NULL;

ALTER TABLE `RmPurchaseOrder` ADD COLUMN `purchaseSourceStateNameSnapshot` VARCHAR(128) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `purchaseSourceStateCodeSnapshot` VARCHAR(2) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `purchaseSourceSnapshot` VARCHAR(32) NULL;
ALTER TABLE `RmPurchaseOrder` ADD COLUMN `purchaseGstModeSnapshot` VARCHAR(32) NULL;

CREATE INDEX `RmPurchaseOrder_supplierLocationId_idx` ON `RmPurchaseOrder`(`supplierLocationId`);

ALTER TABLE `RmPurchaseOrder` ADD CONSTRAINT `RmPurchaseOrder_supplierLocationId_fkey` FOREIGN KEY (`supplierLocationId`) REFERENCES `SupplierLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Grn` ADD COLUMN `supplierLocationId` INTEGER NULL;

CREATE INDEX `Grn_supplierLocationId_idx` ON `Grn`(`supplierLocationId`);

ALTER TABLE `Grn` ADD CONSTRAINT `Grn_supplierLocationId_fkey` FOREIGN KEY (`supplierLocationId`) REFERENCES `SupplierLocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
