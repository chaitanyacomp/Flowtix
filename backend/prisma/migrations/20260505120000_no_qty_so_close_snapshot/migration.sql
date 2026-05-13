-- CreateTable
CREATE TABLE `NoQtySoCloseSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesOrderId` INTEGER NOT NULL,
    `closeVersion` INTEGER NOT NULL,
    `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedByUserId` INTEGER NULL,
    `reopenMode` VARCHAR(32) NULL,
    `reopenedAt` DATETIME(3) NULL,
    `reopenedByUserId` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    `reason` TEXT NULL,

    UNIQUE INDEX `NoQtySoCloseSnapshot_salesOrderId_closeVersion_key`(`salesOrderId`, `closeVersion`),
    INDEX `NoQtySoCloseSnapshot_salesOrderId_idx`(`salesOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NoQtySoClosedShortageLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotId` INTEGER NOT NULL,
    `salesOrderId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `cycleIdAtClose` INTEGER NULL,
    `cycleNoAtClose` INTEGER NULL,
    `closedShortageQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,

    INDEX `NoQtySoClosedShortageLine_snapshotId_idx`(`snapshotId`),
    INDEX `NoQtySoClosedShortageLine_salesOrderId_idx`(`salesOrderId`),
    INDEX `NoQtySoClosedShortageLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NoQtySoCloseSnapshot` ADD CONSTRAINT `NoQtySoCloseSnapshot_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoQtySoCloseSnapshot` ADD CONSTRAINT `NoQtySoCloseSnapshot_closedByUserId_fkey` FOREIGN KEY (`closedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoQtySoCloseSnapshot` ADD CONSTRAINT `NoQtySoCloseSnapshot_reopenedByUserId_fkey` FOREIGN KEY (`reopenedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoQtySoClosedShortageLine` ADD CONSTRAINT `NoQtySoClosedShortageLine_snapshotId_fkey` FOREIGN KEY (`snapshotId`) REFERENCES `NoQtySoCloseSnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoQtySoClosedShortageLine` ADD CONSTRAINT `NoQtySoClosedShortageLine_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NoQtySoClosedShortageLine` ADD CONSTRAINT `NoQtySoClosedShortageLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
