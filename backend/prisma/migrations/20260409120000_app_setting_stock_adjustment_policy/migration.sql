-- Stock adjustment policy on singleton AppSetting row. AppSetting was never in init.
CREATE TABLE IF NOT EXISTS `AppSetting` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `strictInventoryControl` BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `AppSetting` (`id`, `strictInventoryControl`) VALUES (1, false);

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'AppSetting'
        AND COLUMN_NAME = 'stockAdjustmentReverseRoles'
    ),
    'SELECT 1',
    'ALTER TABLE `AppSetting` ADD COLUMN `stockAdjustmentReverseRoles` VARCHAR(191) NOT NULL DEFAULT ''ADMIN_ONLY'''
  )
);
PREPARE as_rr FROM @sql;
EXECUTE as_rr;
DEALLOCATE PREPARE as_rr;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'AppSetting'
        AND COLUMN_NAME = 'stockAdjustmentReverseWindowType'
    ),
    'SELECT 1',
    'ALTER TABLE `AppSetting` ADD COLUMN `stockAdjustmentReverseWindowType` VARCHAR(191) NOT NULL DEFAULT ''HOURS'''
  )
);
PREPARE as_rwt FROM @sql;
EXECUTE as_rwt;
DEALLOCATE PREPARE as_rwt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'AppSetting'
        AND COLUMN_NAME = 'stockAdjustmentReverseWindowValue'
    ),
    'SELECT 1',
    'ALTER TABLE `AppSetting` ADD COLUMN `stockAdjustmentReverseWindowValue` INTEGER NOT NULL DEFAULT 24'
  )
);
PREPARE as_rwv FROM @sql;
EXECUTE as_rwv;
DEALLOCATE PREPARE as_rwv;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'AppSetting'
        AND COLUMN_NAME = 'stockAdjustmentCreateRoles'
    ),
    'SELECT 1',
    'ALTER TABLE `AppSetting` ADD COLUMN `stockAdjustmentCreateRoles` VARCHAR(191) NOT NULL DEFAULT ''ADMIN_AND_STORE'''
  )
);
PREPARE as_cr FROM @sql;
EXECUTE as_cr;
DEALLOCATE PREPARE as_cr;
