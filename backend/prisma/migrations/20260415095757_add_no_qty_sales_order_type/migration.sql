-- DropIndex
DROP INDEX `SalesOrder_originalDispatchId_fkey` ON `salesorder`;

-- DropIndex
DROP INDEX `SalesOrder_originalSalesOrderId_fkey` ON `salesorder`;

-- AlterTable
ALTER TABLE `salesorder` MODIFY `orderType` ENUM('NORMAL', 'REPLACEMENT', 'NO_QTY') NOT NULL DEFAULT 'NORMAL';
