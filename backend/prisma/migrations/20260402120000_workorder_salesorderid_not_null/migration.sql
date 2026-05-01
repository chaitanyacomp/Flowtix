-- Link WorkOrder to SalesOrder: init only had itemId/qty on WorkOrder; salesOrderId was never added in an earlier migration.
-- Shadow DB replay failed with "Unknown column salesOrderId" when this file only ran MODIFY.
-- 1) Add nullable column if missing (safe for DBs that already have it).
-- 2) Backfill from SalesOrder matching legacy WorkOrder.itemId.
-- 3) Fallback: any single SalesOrder id when table has rows but no item match (empty dev DBs: no-op).
-- 4) Enforce NOT NULL (run prisma/cleanup-workorders-null-sales-order.js if any NULLs remain on real data).

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'WorkOrder'
        AND COLUMN_NAME = 'salesOrderId'
    ),
    'SELECT 1',
    'ALTER TABLE `WorkOrder` ADD COLUMN `salesOrderId` INTEGER NULL'
  )
);
PREPARE wo_add_so_col FROM @sql;
EXECUTE wo_add_so_col;
DEALLOCATE PREPARE wo_add_so_col;

UPDATE `WorkOrder` wo
SET `salesOrderId` = (
  SELECT MIN(so.`id`) FROM `SalesOrder` so WHERE so.`itemId` = wo.`itemId`
)
WHERE wo.`salesOrderId` IS NULL;

UPDATE `WorkOrder` wo
CROSS JOIN (SELECT MIN(`id`) AS `id` FROM `SalesOrder`) first_so
SET wo.`salesOrderId` = first_so.`id`
WHERE wo.`salesOrderId` IS NULL AND first_so.`id` IS NOT NULL;

ALTER TABLE `WorkOrder` MODIFY `salesOrderId` INTEGER NOT NULL;
