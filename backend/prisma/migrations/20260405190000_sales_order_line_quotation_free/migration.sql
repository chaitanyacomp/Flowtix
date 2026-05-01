-- SalesOrderLine missing from init; link SO lines to quotation lines.
CREATE TABLE IF NOT EXISTS `SalesOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `soId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    INDEX `SalesOrderLine_soId_idx`(`soId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SalesOrderLine_soId_fkey` FOREIGN KEY (`soId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `SalesOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `SalesOrderLine` (`soId`, `itemId`, `qty`)
SELECT s.`id`, s.`itemId`, s.`qty`
FROM `SalesOrder` s
WHERE NOT EXISTS (SELECT 1 FROM `SalesOrderLine` l WHERE l.`soId` = s.`id`);

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrderLine'
        AND COLUMN_NAME = 'quotationLineId'
    ),
    'SELECT 1',
    'ALTER TABLE `SalesOrderLine` ADD COLUMN `quotationLineId` INTEGER NULL'
  )
);
PREPARE sol_ql FROM @sql;
EXECUTE sol_ql;
DEALLOCATE PREPARE sol_ql;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrderLine'
        AND COLUMN_NAME = 'isFree'
    ),
    'SELECT 1',
    'ALTER TABLE `SalesOrderLine` ADD COLUMN `isFree` BOOLEAN NOT NULL DEFAULT false'
  )
);
PREPARE sol_free FROM @sql;
EXECUTE sol_free;
DEALLOCATE PREPARE sol_free;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrderLine'
        AND INDEX_NAME = 'SalesOrderLine_quotationLineId_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `SalesOrderLine_quotationLineId_idx` ON `SalesOrderLine`(`quotationLineId`)'
  )
);
PREPARE sol_idx FROM @sql;
EXECUTE sol_idx;
DEALLOCATE PREPARE sol_idx;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'SalesOrderLine'
        AND CONSTRAINT_NAME = 'SalesOrderLine_quotationLineId_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `SalesOrderLine` ADD CONSTRAINT `SalesOrderLine_quotationLineId_fkey` FOREIGN KEY (`quotationLineId`) REFERENCES `QuotationLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE'
  )
);
PREPARE sol_fk FROM @sql;
EXECUTE sol_fk;
DEALLOCATE PREPARE sol_fk;
