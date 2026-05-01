SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND COLUMN_NAME = 'fgStockOverrideReason'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrder` ADD COLUMN `fgStockOverrideReason` TEXT NULL'
  )
);
PREPARE wo_fg_r FROM @sql;
EXECUTE wo_fg_r;
DEALLOCATE PREPARE wo_fg_r;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND COLUMN_NAME = 'fgStockOverrideAt'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrder` ADD COLUMN `fgStockOverrideAt` DATETIME(3) NULL'
  )
);
PREPARE wo_fg_a FROM @sql;
EXECUTE wo_fg_a;
DEALLOCATE PREPARE wo_fg_a;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND COLUMN_NAME = 'fgStockOverrideByUserId'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrder` ADD COLUMN `fgStockOverrideByUserId` INTEGER NULL'
  )
);
PREPARE wo_fg_u FROM @sql;
EXECUTE wo_fg_u;
DEALLOCATE PREPARE wo_fg_u;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND INDEX_NAME = 'WorkOrder_fgStockOverrideByUserId_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `WorkOrder_fgStockOverrideByUserId_idx` ON `WorkOrder`(`fgStockOverrideByUserId`)'
  )
);
PREPARE wo_fg_idx FROM @sql;
EXECUTE wo_fg_idx;
DEALLOCATE PREPARE wo_fg_idx;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND CONSTRAINT_NAME = 'WorkOrder_fgStockOverrideByUserId_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_fgStockOverrideByUserId_fkey` FOREIGN KEY (`fgStockOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE wo_fg_fk FROM @sql;
EXECUTE wo_fg_fk;
DEALLOCATE PREPARE wo_fg_fk;