-- Location Master + location-aware stock foundation (Phase 1)
-- Legacy stock without locationId is backfilled to RM Store for compatibility.

CREATE TABLE `Location` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `locationCode` VARCHAR(32) NOT NULL,
  `locationName` VARCHAR(128) NOT NULL,
  `locationType` ENUM(
    'RM_STORE',
    'PRODUCTION',
    'FG_STORE',
    'WIP',
    'SCRAP',
    'VENDOR',
    'CONSUMABLE',
    'DISPATCH'
  ) NOT NULL,
  `departmentOwner` ENUM('STORES', 'PRODUCTION', 'PURCHASE', 'PLANT_HEAD') NOT NULL,
  `allowRm` BOOLEAN NOT NULL DEFAULT false,
  `allowFg` BOOLEAN NOT NULL DEFAULT false,
  `allowSfg` BOOLEAN NOT NULL DEFAULT false,
  `allowConsumable` BOOLEAN NOT NULL DEFAULT false,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `isSystem` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Location_locationCode_key`(`locationCode`),
  INDEX `Location_locationType_idx`(`locationType`),
  INDEX `Location_isActive_idx`(`isActive`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `Location` (
  `locationCode`,
  `locationName`,
  `locationType`,
  `departmentOwner`,
  `allowRm`,
  `allowFg`,
  `allowSfg`,
  `allowConsumable`,
  `isActive`,
  `isSystem`,
  `updatedAt`
) VALUES
  ('LOC-RM-STORE', 'RM Store', 'RM_STORE', 'STORES', true, false, false, true, true, true, NOW(3)),
  ('LOC-PRODUCTION', 'Production', 'PRODUCTION', 'PRODUCTION', true, true, true, true, true, true, NOW(3)),
  ('LOC-FG-STORE', 'FG Store', 'FG_STORE', 'STORES', false, true, true, false, true, true, NOW(3)),
  ('LOC-SCRAP', 'Scrap Yard', 'SCRAP', 'PLANT_HEAD', true, true, false, false, true, true, NOW(3)),
  ('LOC-WIP', 'WIP', 'WIP', 'PRODUCTION', true, true, true, false, true, true, NOW(3));

ALTER TABLE `StockTransaction` ADD COLUMN `locationId` INT NULL;

UPDATE `StockTransaction` st
SET st.`locationId` = (SELECT l.`id` FROM `Location` l WHERE l.`locationCode` = 'LOC-RM-STORE' LIMIT 1)
WHERE st.`locationId` IS NULL;

ALTER TABLE `StockTransaction`
  ADD CONSTRAINT `StockTransaction_locationId_fkey`
    FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX `StockTransaction_locationId_itemId_stockBucket_idx`
  ON `StockTransaction`(`locationId`, `itemId`, `stockBucket`);
