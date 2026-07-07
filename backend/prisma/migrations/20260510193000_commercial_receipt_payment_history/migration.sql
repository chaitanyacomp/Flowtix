-- Commercial receipt/payment line history (sums drive bill receivedAmount/paidAmount).

CREATE TABLE `SalesBillReceipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesBillId` INTEGER NOT NULL,
    `receiptDate` DATE NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `mode` ENUM('CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `referenceNo` VARCHAR(128) NULL,
    `remarks` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `PurchaseBillPayment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseBillId` INTEGER NOT NULL,
    `paymentDate` DATE NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `mode` ENUM('CASH', 'BANK', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `referenceNo` VARCHAR(128) NULL,
    `remarks` TEXT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `SalesBillReceipt_salesBillId_idx` ON `SalesBillReceipt`(`salesBillId`);
CREATE INDEX `SalesBillReceipt_receiptDate_idx` ON `SalesBillReceipt`(`receiptDate`);
CREATE INDEX `PurchaseBillPayment_purchaseBillId_idx` ON `PurchaseBillPayment`(`purchaseBillId`);
CREATE INDEX `PurchaseBillPayment_paymentDate_idx` ON `PurchaseBillPayment`(`paymentDate`);

ALTER TABLE `SalesBillReceipt` ADD CONSTRAINT `SalesBillReceipt_salesBillId_fkey` FOREIGN KEY (`salesBillId`) REFERENCES `SalesBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SalesBillReceipt` ADD CONSTRAINT `SalesBillReceipt_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseBillPayment` ADD CONSTRAINT `PurchaseBillPayment_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `PurchaseBillPayment` ADD CONSTRAINT `PurchaseBillPayment_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Receipt/payment snapshot backfill and bill total normalization run in
-- 20260510200000_accounts_role_payment_tracking after SalesBill.receivedAmount /
-- PurchaseBill.paidAmount columns are created.
