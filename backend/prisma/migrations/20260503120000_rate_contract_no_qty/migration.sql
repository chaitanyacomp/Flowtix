-- CreateTable
CREATE TABLE `RateContractLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `rate` DECIMAL(18, 4) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `status` ENUM('APPROVED') NOT NULL DEFAULT 'APPROVED',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RateContractLine_customerId_itemId_effectiveFrom_idx`(`customerId`, `itemId`, `effectiveFrom`),
    INDEX `RateContractLine_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RateContractLine` ADD CONSTRAINT `RateContractLine_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RateContractLine` ADD CONSTRAINT `RateContractLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `SalesOrderLine` ADD COLUMN `gstRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `rateEffectiveFrom` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `SalesBillLine` ADD COLUMN `rateEffectiveFrom` DATETIME(3) NULL;
