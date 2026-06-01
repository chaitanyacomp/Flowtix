-- Operational BOM redesign: doc number, type, status, revision, effective date, remarks.

ALTER TABLE `Bom`
  ADD COLUMN `docNo` VARCHAR(32) NULL,
  ADD COLUMN `bomType` ENUM('STANDARD', 'APPROXIMATE', 'CUSTOMER_SPECIFIC') NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN `status` ENUM('DRAFT', 'APPROVED', 'INACTIVE') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `revisionNo` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `effectiveFrom` DATE NULL,
  ADD COLUMN `remarks` VARCHAR(500) NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL;

CREATE UNIQUE INDEX `Bom_docNo_key` ON `Bom`(`docNo`);
CREATE INDEX `Bom_status_idx` ON `Bom`(`status`);
CREATE INDEX `Bom_bomType_idx` ON `Bom`(`bomType`);

-- Existing BOMs were live/locked: treat as approved.
UPDATE `Bom`
SET
  `status` = 'APPROVED',
  `approvedAt` = COALESCE(`lockedAt`, `updatedAt`, NOW(3)),
  `docNo` = CONCAT('BOM-LEG-', LPAD(`id`, 4, '0'))
WHERE `docNo` IS NULL;

-- Extend DocType enum for doc sequence (MySQL).
ALTER TABLE `DocSequence` MODIFY `docType` ENUM(
  'SALES_ORDER',
  'WORK_ORDER',
  'PRODUCTION_ENTRY',
  'QC_ENTRY',
  'DISPATCH',
  'SALES_BILL',
  'REQUIREMENT_SHEET',
  'BOM'
) NOT NULL;
