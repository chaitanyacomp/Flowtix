-- FT-WF-023: preserve dispatch Ship To + allow draft invoice Ship To selection

ALTER TABLE `SalesBill`
  ADD COLUMN `dispatchShipToLabelSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN `dispatchShipToAddressSnapshot` TEXT NOT NULL,
  ADD COLUMN `dispatchShipToGstinSnapshot` VARCHAR(15) NOT NULL DEFAULT '',
  ADD COLUMN `dispatchShipToStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN `dispatchShipToStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '',
  ADD COLUMN `shipToAddressId` INTEGER NULL,
  ADD COLUMN `shipToChangedAt` DATETIME(3) NULL,
  ADD COLUMN `shipToChangedById` INTEGER NULL,
  ADD COLUMN `shipToChangeReason` TEXT NULL;

UPDATE `SalesBill`
SET
  `dispatchShipToLabelSnapshot` = `shipToLabelSnapshot`,
  `dispatchShipToAddressSnapshot` = `shipToAddressSnapshot`,
  `dispatchShipToGstinSnapshot` = `shipToGstinSnapshot`,
  `dispatchShipToStateNameSnapshot` = `shipToStateNameSnapshot`,
  `dispatchShipToStateCodeSnapshot` = `shipToStateCodeSnapshot`
WHERE
  (`dispatchShipToLabelSnapshot` = '' OR `dispatchShipToLabelSnapshot` IS NULL)
  AND (
    `shipToLabelSnapshot` <> ''
    OR `shipToAddressSnapshot` <> ''
    OR `shipToStateCodeSnapshot` <> ''
  );

CREATE INDEX `SalesBill_shipToAddressId_idx` ON `SalesBill`(`shipToAddressId`);
CREATE INDEX `SalesBill_shipToChangedById_idx` ON `SalesBill`(`shipToChangedById`);

ALTER TABLE `SalesBill`
  ADD CONSTRAINT `SalesBill_shipToAddressId_fkey`
    FOREIGN KEY (`shipToAddressId`) REFERENCES `CustomerDeliveryAddress`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `SalesBill_shipToChangedById_fkey`
    FOREIGN KEY (`shipToChangedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
