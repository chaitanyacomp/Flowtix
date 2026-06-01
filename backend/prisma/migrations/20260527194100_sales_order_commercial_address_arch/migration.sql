-- Phase 1: Sales Order commercial address architecture (Bill To / Ship To snapshots + POS)
-- Backward compatible: all new snapshot fields nullable.

ALTER TABLE `SalesOrder`
  ADD COLUMN `shipToAddressId` INTEGER NULL,
  ADD COLUMN `billToNameSnapshot` VARCHAR(256) NULL,
  ADD COLUMN `billToAddressSnapshot` TEXT NULL,
  ADD COLUMN `billToGstinSnapshot` VARCHAR(15) NULL,
  ADD COLUMN `billToStateNameSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `billToStateCodeSnapshot` VARCHAR(2) NULL,
  ADD COLUMN `shipToLabelSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `shipToAddressSnapshot` TEXT NULL,
  ADD COLUMN `shipToGstinSnapshot` VARCHAR(15) NULL,
  ADD COLUMN `shipToStateNameSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `shipToStateCodeSnapshot` VARCHAR(2) NULL,
  ADD COLUMN `posStateNameSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `posStateCodeSnapshot` VARCHAR(2) NULL,
  ADD COLUMN `posSourceSnapshot` VARCHAR(32) NULL;

CREATE INDEX `SalesOrder_shipToAddressId_idx` ON `SalesOrder`(`shipToAddressId`);

ALTER TABLE `SalesOrder`
  ADD CONSTRAINT `SalesOrder_shipToAddressId_fkey`
  FOREIGN KEY (`shipToAddressId`) REFERENCES `CustomerDeliveryAddress`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

