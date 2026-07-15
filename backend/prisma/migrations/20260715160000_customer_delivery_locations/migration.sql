-- Customer Delivery Address → Delivery Location fields + Dispatch ship-to snapshot

ALTER TABLE `CustomerDeliveryAddress`
  ADD COLUMN `locationType` VARCHAR(32) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN `district` VARCHAR(128) NULL,
  ADD COLUMN `pincode` VARCHAR(16) NULL,
  ADD COLUMN `country` VARCHAR(64) NULL,
  ADD COLUMN `email` VARCHAR(254) NULL,
  ADD COLUMN `notes` TEXT NULL;

UPDATE `CustomerDeliveryAddress`
SET `locationType` = 'REGISTERED_OFFICE'
WHERE LOWER(TRIM(`label`)) IN ('registered office', 'primary');

CREATE INDEX `CustomerDeliveryAddress_locationType_idx` ON `CustomerDeliveryAddress`(`locationType`);

ALTER TABLE `Dispatch`
  ADD COLUMN `deliveryLocationId` INT NULL,
  ADD COLUMN `deliveryLocationLabelSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `deliveryAddressSnapshot` TEXT NULL,
  ADD COLUMN `deliveryCitySnapshot` VARCHAR(128) NULL,
  ADD COLUMN `deliveryStateNameSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `deliveryStateCodeSnapshot` VARCHAR(2) NULL,
  ADD COLUMN `deliveryPincodeSnapshot` VARCHAR(16) NULL,
  ADD COLUMN `deliveryCountrySnapshot` VARCHAR(64) NULL,
  ADD COLUMN `deliveryGstinSnapshot` VARCHAR(15) NULL,
  ADD COLUMN `deliveryContactPersonSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `deliveryPhoneSnapshot` VARCHAR(32) NULL,
  ADD COLUMN `deliveryEmailSnapshot` VARCHAR(254) NULL;

CREATE INDEX `Dispatch_deliveryLocationId_idx` ON `Dispatch`(`deliveryLocationId`);

ALTER TABLE `Dispatch`
  ADD CONSTRAINT `Dispatch_deliveryLocationId_fkey`
  FOREIGN KEY (`deliveryLocationId`) REFERENCES `CustomerDeliveryAddress`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
