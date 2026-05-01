-- SalesOrder replacement flow fields (manual SQL migration).
-- Adds minimal linkage to trace: Replacement SO -> CustomerReturn -> Original Dispatch -> Original SO.

ALTER TABLE `SalesOrder`
  ADD COLUMN `orderType` ENUM('NORMAL','REPLACEMENT') NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN `customerReturnId` INT NULL,
  ADD COLUMN `originalSalesOrderId` INT NULL,
  ADD COLUMN `originalDispatchId` INT NULL;

-- One replacement sales order per customer return (phase 1).
CREATE UNIQUE INDEX `SalesOrder_customerReturnId_unique` ON `SalesOrder`(`customerReturnId`);
CREATE INDEX `SalesOrder_orderType_idx` ON `SalesOrder`(`orderType`);
CREATE INDEX `SalesOrder_customerReturnId_idx` ON `SalesOrder`(`customerReturnId`);

ALTER TABLE `SalesOrder`
  ADD CONSTRAINT `SalesOrder_customerReturnId_fkey`
    FOREIGN KEY (`customerReturnId`) REFERENCES `CustomerReturn`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesOrder`
  ADD CONSTRAINT `SalesOrder_originalSalesOrderId_fkey`
    FOREIGN KEY (`originalSalesOrderId`) REFERENCES `SalesOrder`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `SalesOrder`
  ADD CONSTRAINT `SalesOrder_originalDispatchId_fkey`
    FOREIGN KEY (`originalDispatchId`) REFERENCES `Dispatch`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

