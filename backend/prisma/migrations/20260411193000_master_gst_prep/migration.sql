-- Item: HSN + GST rate % (nullable; no tax calculation yet)
-- Supplier: state (base Supplier table was never in init/migrations)
-- App settings: company state for future same-state vs IGST logic

CREATE TABLE IF NOT EXISTS `Supplier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `contact` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `gst` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Item` ADD COLUMN `hsnCode` VARCHAR(32) NULL,
    ADD COLUMN `gstRate` DECIMAL(5, 2) NULL;

ALTER TABLE `Supplier` ADD COLUMN `state` VARCHAR(128) NULL;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'AppSetting'
        AND COLUMN_NAME = 'companyState'
    ),
    'SELECT 1',
    'ALTER TABLE `AppSetting` ADD COLUMN `companyState` VARCHAR(128) NULL'
  )
);
PREPARE as_cs FROM @sql;
EXECUTE as_cs;
DEALLOCATE PREPARE as_cs;
