-- P16-19A — Production Report wastage classification foundation

CREATE TABLE `WastageType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WastageType_name_key`(`name`),
    INDEX `WastageType_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionWorkOrderReportWastageDetail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productionReportId` INTEGER NOT NULL,
    `wastageTypeId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `remarks` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `ProductionWorkOrderReportWastageDetail_productionReportId_idx`(`productionReportId`),
    INDEX `ProductionWorkOrderReportWastageDetail_wastageTypeId_idx`(`wastageTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductionWorkOrderReportWastageDetail` ADD CONSTRAINT `ProductionWorkOrderReportWastageDetail_productionReportId_fkey` FOREIGN KEY (`productionReportId`) REFERENCES `ProductionWorkOrderReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductionWorkOrderReportWastageDetail` ADD CONSTRAINT `ProductionWorkOrderReportWastageDetail_wastageTypeId_fkey` FOREIGN KEY (`wastageTypeId`) REFERENCES `WastageType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `WastageType` (`name`, `sortOrder`, `isActive`, `updatedAt`) VALUES
('Purging', 10, true, CURRENT_TIMESTAMP(3)),
('Machine Setting', 20, true, CURRENT_TIMESTAMP(3)),
('Material Handling', 30, true, CURRENT_TIMESTAMP(3)),
('Colour Change', 40, true, CURRENT_TIMESTAMP(3)),
('Trial Production', 50, true, CURRENT_TIMESTAMP(3)),
('Machine Breakdown', 60, true, CURRENT_TIMESTAMP(3)),
('QC Rejection', 70, true, CURRENT_TIMESTAMP(3)),
('Runner / Sprue', 80, true, CURRENT_TIMESTAMP(3)),
('Spillage', 90, true, CURRENT_TIMESTAMP(3)),
('Moisture Loss', 100, true, CURRENT_TIMESTAMP(3)),
('Other', 110, true, CURRENT_TIMESTAMP(3));
