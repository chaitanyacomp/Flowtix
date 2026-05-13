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
