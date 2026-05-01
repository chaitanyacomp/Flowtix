-- Purchase bill (supplier invoice from GRN; no stock) + GRN billing status.

ALTER TABLE `Grn` ADD COLUMN `billingStatus` ENUM('PENDING', 'BILLED') NOT NULL DEFAULT 'PENDING';

CREATE INDEX `Grn_billingStatus_idx` ON `Grn`(`billingStatus`);

CREATE TABLE `PurchaseBill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billNo` VARCHAR(128) NULL,
    `billDate` DATE NOT NULL,
    `dueDate` DATE NULL,
    `supplierId` INTEGER NOT NULL,
    `grnId` INTEGER NOT NULL,
    `remarks` TEXT NULL,
    `status` ENUM('DRAFT', 'FINALIZED') NOT NULL DEFAULT 'DRAFT',
    `totalBasic` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalCgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalSgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalIgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `finalizedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseBill_grnId_key`(`grnId`),
    INDEX `PurchaseBill_supplierId_idx`(`supplierId`),
    INDEX `PurchaseBill_billDate_idx`(`billDate`),
    INDEX `PurchaseBill_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseBillLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseBillId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `unitSnapshot` VARCHAR(64) NOT NULL,
    `rate` DECIMAL(18, 4) NOT NULL,
    `basicAmount` DECIMAL(18, 2) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL,
    `cgstAmount` DECIMAL(18, 2) NOT NULL,
    `sgstAmount` DECIMAL(18, 2) NOT NULL,
    `igstAmount` DECIMAL(18, 2) NOT NULL,
    `lineTotal` DECIMAL(18, 2) NOT NULL,

    INDEX `PurchaseBillLine_purchaseBillId_idx`(`purchaseBillId`),
    INDEX `PurchaseBillLine_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `Grn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `PurchaseBillLine` ADD CONSTRAINT `PurchaseBillLine_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PurchaseBillLine` ADD CONSTRAINT `PurchaseBillLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
