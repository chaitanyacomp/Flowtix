-- One-time legacy classification for pre–new-flow production QC rejects (no QcEntry field edits).

CREATE TABLE `QcLegacyRejectedClassification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sourceQcEntryId` INTEGER NOT NULL,
    `workOrderId` INTEGER NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `action` ENUM('APPROVE_TO_USABLE', 'MOVE_TO_HOLD', 'SCRAP') NOT NULL,
    `fromStockBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NULL,
    `toStockBucket` ENUM('USABLE', 'QC_HOLD', 'QC_PENDING', 'REWORK', 'SCRAP') NULL,
    `remarks` TEXT NULL,
    `createdByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedAt` DATETIME(3) NULL,

    UNIQUE INDEX `QcLegacyRejectedClassification_sourceQcEntryId_key`(`sourceQcEntryId`),
    INDEX `QcLegacyRejectedClassification_itemId_idx`(`itemId`),
    INDEX `QcLegacyRejectedClassification_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QcLegacyRejectedClassification`
  ADD CONSTRAINT `QcLegacyRejectedClassification_sourceQcEntryId_fkey`
    FOREIGN KEY (`sourceQcEntryId`) REFERENCES `QcEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `QcLegacyRejectedClassification_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `QcLegacyRejectedClassification_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `QcLegacyRejectedClassification_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
