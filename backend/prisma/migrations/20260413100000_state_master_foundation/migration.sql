-- Step 1: State master foundation (GST prep, Tally-ready)
-- Backward-safe: keep legacy free-text state fields; add nullable stateId links.

CREATE TABLE `State` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `stateName` VARCHAR(128) NOT NULL,
  `stateCode` VARCHAR(2) NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `State_stateName_key`(`stateName`),
  UNIQUE INDEX `State_stateCode_key`(`stateCode`),
  INDEX `State_isActive_idx`(`isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Supplier` ADD COLUMN `stateId` INTEGER NULL;
ALTER TABLE `Customer` ADD COLUMN `stateId` INTEGER NULL;
ALTER TABLE `AppSetting` ADD COLUMN `companyStateId` INTEGER NULL;

CREATE INDEX `Supplier_stateId_idx` ON `Supplier`(`stateId`);
CREATE INDEX `Customer_stateId_idx` ON `Customer`(`stateId`);

ALTER TABLE `Supplier`
  ADD CONSTRAINT `Supplier_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `State`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Customer`
  ADD CONSTRAINT `Customer_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `State`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AppSetting`
  ADD CONSTRAINT `AppSetting_companyStateId_fkey` FOREIGN KEY (`companyStateId`) REFERENCES `State`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

