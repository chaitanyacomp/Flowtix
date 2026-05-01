-- WorkOrderLine + ProductionEntry.workOrderLineId were never introduced in earlier migrations (init used ProductionEntry.workOrderId).
-- Planned production target per WO line (>= qty); backfill from existing required qty.

CREATE TABLE IF NOT EXISTS `WorkOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workOrderId` INTEGER NOT NULL,
    `fgItemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    INDEX `WorkOrderLine_workOrderId_idx`(`workOrderId`),
    INDEX `WorkOrderLine_fgItemId_idx`(`fgItemId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `WorkOrderLine_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `WorkOrderLine_fgItemId_fkey` FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `WorkOrderLine` (`workOrderId`, `fgItemId`, `qty`)
SELECT wo.`id`, wo.`itemId`, wo.`qty`
FROM `WorkOrder` wo
WHERE NOT EXISTS (SELECT 1 FROM `WorkOrderLine` wol WHERE wol.`workOrderId` = wo.`id`);

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND COLUMN_NAME = 'workOrderLineId'
    ),
    'SELECT 1',
    'ALTER TABLE `ProductionEntry` ADD COLUMN `workOrderLineId` INTEGER NULL'
  )
);
PREPARE pe_wol FROM @sql;
EXECUTE pe_wol;
DEALLOCATE PREPARE pe_wol;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND COLUMN_NAME = 'workOrderId'
    ),
    'UPDATE `ProductionEntry` pe INNER JOIN (SELECT `workOrderId`, MIN(`id`) AS `mid` FROM `WorkOrderLine` GROUP BY `workOrderId`) pick ON pick.`workOrderId` = pe.`workOrderId` SET pe.`workOrderLineId` = pick.`mid` WHERE pe.`workOrderLineId` IS NULL',
    'SELECT 1'
  )
);
PREPARE pe_fill_wol FROM @sql;
EXECUTE pe_fill_wol;
DEALLOCATE PREPARE pe_fill_wol;

ALTER TABLE `ProductionEntry` MODIFY `workOrderLineId` INTEGER NOT NULL;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND CONSTRAINT_NAME = 'ProductionEntry_workOrderId_fkey'
    ),
    'ALTER TABLE `ProductionEntry` DROP FOREIGN KEY `ProductionEntry_workOrderId_fkey`',
    'SELECT 1'
  )
);
PREPARE pe_drop_wo_fk FROM @sql;
EXECUTE pe_drop_wo_fk;
DEALLOCATE PREPARE pe_drop_wo_fk;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND COLUMN_NAME = 'workOrderId'
    ),
    'ALTER TABLE `ProductionEntry` DROP COLUMN `workOrderId`',
    'SELECT 1'
  )
);
PREPARE pe_drop_wo_col FROM @sql;
EXECUTE pe_drop_wo_col;
DEALLOCATE PREPARE pe_drop_wo_col;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND INDEX_NAME = 'ProductionEntry_workOrderLineId_idx'
    ),
    'SELECT 1',
    'CREATE INDEX `ProductionEntry_workOrderLineId_idx` ON `ProductionEntry`(`workOrderLineId`)'
  )
);
PREPARE pe_wol_idx FROM @sql;
EXECUTE pe_wol_idx;
DEALLOCATE PREPARE pe_wol_idx;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ProductionEntry'
        AND CONSTRAINT_NAME = 'ProductionEntry_workOrderLineId_fkey'
    ),
    'SELECT 1',
    'ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_workOrderLineId_fkey` FOREIGN KEY (`workOrderLineId`) REFERENCES `WorkOrderLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE'
  )
);
PREPARE pe_wol_fk FROM @sql;
EXECUTE pe_wol_fk;
DEALLOCATE PREPARE pe_wol_fk;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrderLine'
        AND COLUMN_NAME = 'plannedQty'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrderLine` ADD COLUMN `plannedQty` DECIMAL(18, 3) NULL'
  )
);
PREPARE wol_pq FROM @sql;
EXECUTE wol_pq;
DEALLOCATE PREPARE wol_pq;

UPDATE `WorkOrderLine` SET `plannedQty` = `qty` WHERE `plannedQty` IS NULL;

ALTER TABLE `WorkOrderLine` MODIFY `plannedQty` DECIMAL(18, 3) NOT NULL;
