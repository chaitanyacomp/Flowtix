-- QC full reversal: void original row, reversal header, scrap void + qc link, ledger type.
-- Init migration never created ScrapRecord; shadow replay failed on ALTER TABLE ScrapRecord.
-- Base table is created only when missing; column/index/FK steps are guarded for idempotency.

CREATE TABLE IF NOT EXISTS `ScrapRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fgItemId` INTEGER NOT NULL,
    `workOrderId` INTEGER NOT NULL,
    `rejectedQty` DECIMAL(18, 3) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ScrapRecord_fgItemId_date_idx`(`fgItemId`, `date`),
    INDEX `ScrapRecord_workOrderId_idx`(`workOrderId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ScrapRecord_fgItemId_fkey` FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ScrapRecord_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QcEntry` ADD COLUMN `reversedAt` DATETIME(3) NULL,
    ADD COLUMN `reversalReason` VARCHAR(191) NULL;

CREATE TABLE `QcReversal` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `qcEntryId` INTEGER NOT NULL,
    `reason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `QcReversal_qcEntryId_key`(`qcEntryId`),
    INDEX `QcReversal_qcEntryId_idx`(`qcEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QcReversal` ADD CONSTRAINT `QcReversal_qcEntryId_fkey` FOREIGN KEY (`qcEntryId`) REFERENCES `QcEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ScrapRecord'
        AND COLUMN_NAME = 'voidedAt'
    ),
    'SELECT 1',
    'ALTER TABLE `ScrapRecord` ADD COLUMN `voidedAt` DATETIME(3) NULL'
  )
);
PREPARE sr_void FROM @sql;
EXECUTE sr_void;
DEALLOCATE PREPARE sr_void;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ScrapRecord'
        AND COLUMN_NAME = 'qcEntryId'
    ),
    'SELECT 1',
    'ALTER TABLE `ScrapRecord` ADD COLUMN `qcEntryId` INTEGER NULL'
  )
);
PREPARE sr_qc FROM @sql;
EXECUTE sr_qc;
DEALLOCATE PREPARE sr_qc;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ScrapRecord'
        AND INDEX_NAME = 'ScrapRecord_qcEntryId_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `ScrapRecord_qcEntryId_idx` ON `ScrapRecord`(`qcEntryId`)'
  )
);
PREPARE sr_idx FROM @sql;
EXECUTE sr_idx;
DEALLOCATE PREPARE sr_idx;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ScrapRecord'
        AND CONSTRAINT_NAME = 'ScrapRecord_qcEntryId_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `ScrapRecord` ADD CONSTRAINT `ScrapRecord_qcEntryId_fkey` FOREIGN KEY (`qcEntryId`) REFERENCES `QcEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE sr_fk FROM @sql;
EXECUTE sr_fk;
DEALLOCATE PREPARE sr_fk;

ALTER TABLE `StockTransaction` MODIFY COLUMN `transactionType` ENUM(
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'ADJUSTMENT',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL'
) NOT NULL;
