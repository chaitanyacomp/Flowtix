-- Regular SO "Create from previous" audit trace (MySQL; idempotent column/index adds)
SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrder'
        AND COLUMN_NAME = 'sourceType'
    ),
    'SELECT 1',
    'ALTER TABLE `SalesOrder` ADD COLUMN `sourceType` VARCHAR(16) NULL'
  )
);
PREPARE so_source_type FROM @sql;
EXECUTE so_source_type;
DEALLOCATE PREPARE so_source_type;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrder'
        AND COLUMN_NAME = 'sourceId'
    ),
    'SELECT 1',
    'ALTER TABLE `SalesOrder` ADD COLUMN `sourceId` INT NULL'
  )
);
PREPARE so_source_id FROM @sql;
EXECUTE so_source_id;
DEALLOCATE PREPARE so_source_id;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrder'
        AND INDEX_NAME = 'SalesOrder_sourceType_sourceId_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `SalesOrder_sourceType_sourceId_idx` ON `SalesOrder`(`sourceType`, `sourceId`)'
  )
);
PREPARE so_source_idx FROM @sql;
EXECUTE so_source_idx;
DEALLOCATE PREPARE so_source_idx;
