-- Purchase Bill: allow billing from selected GRN lines (partial and multi-GRN).
-- Keeps backward compatibility: existing PurchaseBill.grnId still populated, but no longer unique.
-- NOTE: Update PurchaseBill.status enum in DB to include CANCELLED when applying this migration.

-- 1) PurchaseBill: make grnId nullable + remove unique + add supplier state snapshots
ALTER TABLE `PurchaseBill`
  MODIFY COLUMN `grnId` INT NULL,
  ADD COLUMN `supplierStateSnapshot` VARCHAR(128) NULL,
  ADD COLUMN `supplierStateCodeSnapshot` VARCHAR(2) NULL,
  ADD COLUMN `hasTemporaryTaxData` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `cancelReason` TEXT NULL,
  ADD COLUMN `cancelledById` INT NULL;

-- Expand enum to include CANCELLED (MySQL stores enums as column type)
ALTER TABLE `PurchaseBill`
  MODIFY COLUMN `status` ENUM('DRAFT','FINALIZED','CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- 2) PurchaseBill.grnId FK should allow nulls now.
-- IMPORTANT: drop FK first, because MySQL can require the backing index.
ALTER TABLE `PurchaseBill`
  DROP FOREIGN KEY `PurchaseBill_grnId_fkey`;

-- Drop unique index on grnId (name may vary depending on Prisma).
-- Prisma default: PurchaseBill_grnId_key
DROP INDEX `PurchaseBill_grnId_key` ON `PurchaseBill`;

ALTER TABLE `PurchaseBill`
  ADD CONSTRAINT `PurchaseBill_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `Grn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) PurchaseBillLine: add source references
ALTER TABLE `PurchaseBillLine`
  ADD COLUMN `grnId` INT NULL,
  ADD COLUMN `grnLineId` INT NULL,
  ADD COLUMN `rmPoId` INT NULL,
  ADD COLUMN `rmPoLineId` INT NULL;

CREATE INDEX `PurchaseBillLine_grnLineId_idx` ON `PurchaseBillLine`(`grnLineId`);
CREATE INDEX `PurchaseBillLine_grnId_idx` ON `PurchaseBillLine`(`grnId`);
CREATE INDEX `PurchaseBillLine_rmPoId_idx` ON `PurchaseBillLine`(`rmPoId`);

ALTER TABLE `PurchaseBillLine`
  ADD CONSTRAINT `PurchaseBillLine_grnLineId_fkey`
  FOREIGN KEY (`grnLineId`) REFERENCES `GrnLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `PurchaseBill`
  ADD CONSTRAINT `PurchaseBill_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

