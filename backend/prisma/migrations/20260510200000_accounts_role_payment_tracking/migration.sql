-- AlterEnum User.role — commercial support role (Tally remains statutory).
ALTER TABLE `User`
  MODIFY `role` ENUM('ADMIN', 'SALES', 'STORE', 'PRODUCTION', 'QC', 'SUPERVISOR', 'ACCOUNTS') NOT NULL;

-- AlterTable SalesBill — ERP-side payment follow-up only (not ledger posting).
ALTER TABLE `SalesBill`
  ADD COLUMN `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `dueDate` DATE NULL,
  ADD COLUMN `receivedAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `pendingAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `paymentRemarks` TEXT NULL;

-- AlterTable PurchaseBill
ALTER TABLE `PurchaseBill`
  ADD COLUMN `paymentStatus` ENUM('PENDING', 'PARTIAL', 'PAID') NOT NULL DEFAULT 'PENDING',
  ADD COLUMN `paidAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN `pendingAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0;

-- Backfill pending amounts for existing finalized bills (commercial snapshot).
UPDATE `SalesBill`
SET `pendingAmount` = `netAmount`
WHERE `status` = 'FINALIZED' AND `cancelledAt` IS NULL;

UPDATE `PurchaseBill`
SET `pendingAmount` = `netAmount`
WHERE `status` = 'FINALIZED' AND `cancelledAt` IS NULL;

-- From 20260510193000: opening snapshot after payment columns exist (sums drive receivedAmount/paidAmount).
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
