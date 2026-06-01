-- Phase 3E — Production RM consumption variance (REGULAR approval snapshot)

CREATE TABLE `ProductionEntryRmConsumption` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `productionEntryId` INT NOT NULL,
  `itemId` INT NOT NULL,
  `standardQty` DECIMAL(18, 3) NOT NULL,
  `actualQty` DECIMAL(18, 3) NOT NULL,
  `varianceQty` DECIMAL(18, 3) NOT NULL,
  `variancePercent` DECIMAL(18, 3) NULL,
  `consumptionType` ENUM('NORMAL', 'EXTRA_PROCESS_LOSS', 'LOWER_USAGE', 'REWORK_RESERVED') NULL,
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `PeRmConsumption_peId_itemId_key`(`productionEntryId`, `itemId`),
  INDEX `ProductionEntryRmConsumption_productionEntryId_idx`(`productionEntryId`),
  INDEX `ProductionEntryRmConsumption_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductionEntryRmConsumption` ADD CONSTRAINT `ProductionEntryRmConsumption_productionEntryId_fkey` FOREIGN KEY (`productionEntryId`) REFERENCES `ProductionEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductionEntryRmConsumption` ADD CONSTRAINT `ProductionEntryRmConsumption_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
