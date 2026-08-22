-- Step 4 — FG Production Standard Master (FG capacity on a machine). Soft-deactivate only.
-- Preview Shift is never stored on this table.

CREATE TABLE `FgProductionStandard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `itemId` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `cycleTimeSeconds` DECIMAL(18, 3) NOT NULL,
    `piecesPerCycle` INTEGER NOT NULL DEFAULT 1,
    `standardEfficiencyPercent` DECIMAL(5, 2) NOT NULL DEFAULT 95,
    `remarks` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FgProductionStandard_itemId_machineId_key`(`itemId`, `machineId`),
    INDEX `FgProductionStandard_isActive_itemId_idx`(`isActive`, `itemId`),
    INDEX `FgProductionStandard_machineId_isActive_idx`(`machineId`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `FgProductionStandard` ADD CONSTRAINT `FgProductionStandard_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `FgProductionStandard` ADD CONSTRAINT `FgProductionStandard_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
