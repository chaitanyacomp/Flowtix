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

-- Opening snapshot: one row per bill that already had a non-zero manual received/paid total.
INSERT INTO `SalesBillReceipt` (`salesBillId`, `receiptDate`, `amount`, `mode`, `referenceNo`, `remarks`, `createdById`, `createdAt`)
SELECT `id`, `billDate`, `receivedAmount`, 'OTHER', NULL, 'Migrated from ERP payment snapshot', NULL, NOW(3)
FROM `SalesBill`
WHERE `status` = 'FINALIZED' AND `cancelledAt` IS NULL AND `receivedAmount` > 0.005;

INSERT INTO `PurchaseBillPayment` (`purchaseBillId`, `paymentDate`, `amount`, `mode`, `referenceNo`, `remarks`, `createdById`, `createdAt`)
SELECT `id`, `billDate`, `paidAmount`, 'OTHER', NULL, 'Migrated from ERP payment snapshot', NULL, NOW(3)
FROM `PurchaseBill`
WHERE `status` = 'FINALIZED' AND `cancelledAt` IS NULL AND `paidAmount` > 0.005;

-- Normalize totals from receipt/payment sums (idempotent with migration inserts).
UPDATE `SalesBill` `sb`
LEFT JOIN (
    SELECT `salesBillId`, SUM(`amount`) AS `tot` FROM `SalesBillReceipt` GROUP BY `salesBillId`
) `r` ON `r`.`salesBillId` = `sb`.`id`
SET
    `sb`.`receivedAmount` = ROUND(COALESCE(`r`.`tot`, 0), 2),
    `sb`.`pendingAmount` = ROUND(`sb`.`netAmount` - COALESCE(`r`.`tot`, 0), 2),
    `sb`.`paymentStatus` = CASE
        WHEN ROUND(`sb`.`netAmount` - COALESCE(`r`.`tot`, 0), 2) <= 0.005 THEN 'PAID'
        WHEN COALESCE(`r`.`tot`, 0) > 0.005 THEN 'PARTIAL'
        ELSE 'PENDING'
    END
WHERE `sb`.`status` = 'FINALIZED' AND `sb`.`cancelledAt` IS NULL;

UPDATE `PurchaseBill` `pb`
LEFT JOIN (
    SELECT `purchaseBillId`, SUM(`amount`) AS `tot` FROM `PurchaseBillPayment` GROUP BY `purchaseBillId`
) `p` ON `p`.`purchaseBillId` = `pb`.`id`
SET
    `pb`.`paidAmount` = ROUND(COALESCE(`p`.`tot`, 0), 2),
    `pb`.`pendingAmount` = ROUND(`pb`.`netAmount` - COALESCE(`p`.`tot`, 0), 2),
    `pb`.`paymentStatus` = CASE
        WHEN ROUND(`pb`.`netAmount` - COALESCE(`p`.`tot`, 0), 2) <= 0.005 THEN 'PAID'
        WHEN COALESCE(`p`.`tot`, 0) > 0.005 THEN 'PARTIAL'
        ELSE 'PENDING'
    END
WHERE `pb`.`status` = 'FINALIZED' AND `pb`.`cancelledAt` IS NULL;
