-- Persist exact Tally master identity (NAME + GUID) for parties, items, and units.
-- Used by Sales Bill voucher export so imported masters are referenced, not re-created.

ALTER TABLE `Supplier`
  ADD COLUMN `tallyName` VARCHAR(255) NULL,
  ADD COLUMN `tallyGuid` VARCHAR(64) NULL,
  ADD COLUMN `tallyImportedAt` DATETIME(3) NULL;

CREATE INDEX `Supplier_tallyName_idx` ON `Supplier`(`tallyName`);
CREATE INDEX `Supplier_tallyGuid_idx` ON `Supplier`(`tallyGuid`);

ALTER TABLE `Customer`
  ADD COLUMN `tallyName` VARCHAR(255) NULL,
  ADD COLUMN `tallyGuid` VARCHAR(64) NULL,
  ADD COLUMN `tallyImportedAt` DATETIME(3) NULL;

CREATE INDEX `Customer_tallyName_idx` ON `Customer`(`tallyName`);
CREATE INDEX `Customer_tallyGuid_idx` ON `Customer`(`tallyGuid`);

ALTER TABLE `Item`
  ADD COLUMN `tallyName` VARCHAR(255) NULL,
  ADD COLUMN `tallyGuid` VARCHAR(64) NULL,
  ADD COLUMN `tallyImportedAt` DATETIME(3) NULL;

CREATE INDEX `Item_tallyName_idx` ON `Item`(`tallyName`);
CREATE INDEX `Item_tallyGuid_idx` ON `Item`(`tallyGuid`);

ALTER TABLE `Unit`
  ADD COLUMN `tallyName` VARCHAR(64) NULL,
  ADD COLUMN `tallyGuid` VARCHAR(64) NULL,
  ADD COLUMN `tallyImportedAt` DATETIME(3) NULL;

CREATE INDEX `Unit_tallyName_idx` ON `Unit`(`tallyName`);
CREATE INDEX `Unit_tallyGuid_idx` ON `Unit`(`tallyGuid`);
