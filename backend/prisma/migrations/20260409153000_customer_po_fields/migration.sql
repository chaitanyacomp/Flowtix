-- Add Customer PO identifiers and dates.
-- Backfill existing rows so poNumber/poDate can be NOT NULL.

ALTER TABLE `CustomerPO`
  ADD COLUMN `poNumber` VARCHAR(64) NULL,
  ADD COLUMN `poDate` DATETIME(3) NULL,
  ADD COLUMN `requiredDate` DATETIME(3) NULL;

-- Backfill legacy records (avoid "PO-{id}" display; mark as legacy).
UPDATE `CustomerPO`
SET
  `poNumber` = COALESCE(`poNumber`, CONCAT('LEGACY-', `id`)),
  `poDate` = COALESCE(`poDate`, `createdAt`)
WHERE `poNumber` IS NULL OR `poDate` IS NULL;

ALTER TABLE `CustomerPO`
  MODIFY `poNumber` VARCHAR(64) NOT NULL,
  MODIFY `poDate` DATETIME(3) NOT NULL;

CREATE INDEX `CustomerPO_poNumber_idx` ON `CustomerPO`(`poNumber`);

