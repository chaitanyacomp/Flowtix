-- Denormalized supplier snapshot + enforce supplierInvoiceNo with legacy backfill.
-- Depends on supplierInvoiceNo column existing (migration 20260501183000). If absent, adds it nullable first.

-- Step 1: supplierId on Grn
ALTER TABLE `Grn` ADD COLUMN `supplierId` INTEGER NULL;

-- Step 2: Backfill supplier from RM PO (authoritative supplier at linkage time).
UPDATE `Grn` g
INNER JOIN `RmPurchaseOrder` p ON g.`rmPoId` = p.`id`
SET g.`supplierId` = p.`supplierId`;

-- Step 3: Ensure every row has invoice text (historical receipts without invoice number).
UPDATE `Grn`
SET `supplierInvoiceNo` = CONCAT('LEGACY-', CAST(`id` AS CHAR))
WHERE `supplierInvoiceNo` IS NULL;

-- Step 4: NOT NULL constraints
ALTER TABLE `Grn` MODIFY `supplierInvoiceNo` VARCHAR(128) NOT NULL;
ALTER TABLE `Grn` MODIFY `supplierId` INTEGER NOT NULL;

-- Step 5: Supplier FK
ALTER TABLE `Grn` ADD CONSTRAINT `Grn_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 6: Lookup-friendly index for uniqueness checks
CREATE INDEX `Grn_supplierId_supplierInvoiceNo_idx` ON `Grn`(`supplierId`, `supplierInvoiceNo`);
