-- QuotationLine was never created in init; shadow replay failed on ALTER.
CREATE TABLE IF NOT EXISTS `QuotationLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `rate` DECIMAL(18, 2) NOT NULL,
    `discountPct` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `gstPct` DECIMAL(18, 2) NOT NULL DEFAULT 18,
    `lineTotal` DECIMAL(18, 2) NOT NULL,
    INDEX `QuotationLine_quotationId_idx`(`quotationId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `QuotationLine_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `QuotationLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'QuotationLine'
        AND COLUMN_NAME = 'isFree'
    ),
    'SELECT 1',
    'ALTER TABLE `QuotationLine` ADD COLUMN `isFree` BOOLEAN NOT NULL DEFAULT false'
  )
);
PREPARE ql_free FROM @sql;
EXECUTE ql_free;
DEALLOCATE PREPARE ql_free;
