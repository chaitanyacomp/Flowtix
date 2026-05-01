/*
  Warnings:

  - You are about to drop the column `qtyRequiredPerUnit` on the `bomline` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `customerpo` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `customerpo` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `enquiry` table. All the data in the column will be lost.
  - You are about to drop the column `receivedQty` on the `grn` table. All the data in the column will be lost.
  - You are about to drop the column `price` on the `quotation` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `rmpurchaseorder` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `rmpurchaseorder` table. All the data in the column will be lost.
  - You are about to drop the column `supplierName` on the `rmpurchaseorder` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `salesorder` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `salesorder` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `workorder` table. All the data in the column will be lost.
  - You are about to drop the column `qty` on the `workorder` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[quotationNo]` on the table `Quotation` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[quotationId]` on the table `SalesOrder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `baseQty` to the `BomLine` table without a default value. This is not possible if the table is not empty.
  - Added the required column `itemId` to the `Dispatch` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierId` to the `RmPurchaseOrder` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `customerpo` DROP FOREIGN KEY `CustomerPO_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `enquiry` DROP FOREIGN KEY `Enquiry_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `rmpurchaseorder` DROP FOREIGN KEY `RmPurchaseOrder_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `salesorder` DROP FOREIGN KEY `SalesOrder_itemId_fkey`;

-- DropForeignKey
ALTER TABLE `salesorder` DROP FOREIGN KEY `SalesOrder_originalDispatchId_fkey`;

-- DropForeignKey
ALTER TABLE `salesorder` DROP FOREIGN KEY `SalesOrder_originalSalesOrderId_fkey`;

-- DropForeignKey
ALTER TABLE `workorder` DROP FOREIGN KEY `WorkOrder_itemId_fkey`;

-- DropIndex
DROP INDEX `CustomerReturn_currentBucket_idx` ON `customerreturn`;

-- DropIndex
DROP INDEX `CustomerReturn_status_idx` ON `customerreturn`;

-- AlterTable
ALTER TABLE `bomline` DROP COLUMN `qtyRequiredPerUnit`,
    ADD COLUMN `baseQty` DECIMAL(18, 3) NOT NULL,
    ADD COLUMN `wastagePercent` DECIMAL(18, 3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `customerpo` DROP COLUMN `itemId`,
    DROP COLUMN `qty`,
    ADD COLUMN `supplierId` INTEGER NULL;

-- AlterTable
ALTER TABLE `dispatch` ADD COLUMN `itemId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `enquiry` DROP COLUMN `itemId`,
    DROP COLUMN `qty`,
    ADD COLUMN `remarks` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `grn` DROP COLUMN `receivedQty`;

-- AlterTable
ALTER TABLE `grnline` ADD COLUMN `rateSnapshot` DECIMAL(18, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `item` ADD COLUMN `planningGapGreenThresholdPercent` DECIMAL(5, 2) NULL,
    ADD COLUMN `planningGapYellowThresholdPercent` DECIMAL(5, 2) NULL;

-- AlterTable
ALTER TABLE `purchasebill` ADD COLUMN `exportResetAt` DATETIME(3) NULL,
    ADD COLUMN `exportResetById` INTEGER NULL,
    ADD COLUMN `exportResetReason` TEXT NULL,
    ADD COLUMN `exportedAt` DATETIME(3) NULL,
    ADD COLUMN `exportedFileName` VARCHAR(255) NULL,
    ADD COLUMN `isExported` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `purchasebillline` ADD COLUMN `hsnCodeSnapshot` VARCHAR(32) NOT NULL DEFAULT '',
    ADD COLUMN `itemNameSnapshot` VARCHAR(256) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `quotation` DROP COLUMN `price`,
    ADD COLUMN `approvalCancelReason` VARCHAR(191) NULL,
    ADD COLUMN `approvalCancelledAt` DATETIME(3) NULL,
    ADD COLUMN `approvalCancelledByUserId` INTEGER NULL,
    ADD COLUMN `gstTotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `quotationNo` VARCHAR(191) NULL,
    ADD COLUMN `subtotal` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `terms` VARCHAR(191) NULL,
    ADD COLUMN `totalAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `workflowStatus` ENUM('DRAFT', 'SENT', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `rmpurchaseorder` DROP COLUMN `itemId`,
    DROP COLUMN `qty`,
    DROP COLUMN `supplierName`,
    ADD COLUMN `supplierId` INTEGER NOT NULL;

-- AlterTable
ALTER TABLE `salesorder` DROP COLUMN `itemId`,
    DROP COLUMN `qty`,
    ADD COLUMN `customerId` INTEGER NULL,
    ADD COLUMN `customerPoReference` VARCHAR(191) NULL,
    ADD COLUMN `internalStatus` ENUM('DRAFT', 'APPROVED', 'IN_PROCESS', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `quotationId` INTEGER NULL,
    ADD COLUMN `remarks` VARCHAR(191) NULL,
    MODIFY `poId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesorderline` ADD COLUMN `rate` DECIMAL(18, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `supplier` ADD COLUMN `stateCode` VARCHAR(2) NULL,
    ADD COLUMN `stateName` VARCHAR(128) NULL;

-- AlterTable
ALTER TABLE `workorder` DROP COLUMN `itemId`,
    DROP COLUMN `qty`;

-- CreateTable
CREATE TABLE `EnquiryLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enquiryId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,

    INDEX `EnquiryLine_enquiryId_idx`(`enquiryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerPOLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `rate` DECIMAL(18, 2) NOT NULL,
    `discountPct` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `gstPct` DECIMAL(18, 2) NOT NULL DEFAULT 18,
    `lineTotal` DECIMAL(18, 2) NOT NULL,

    INDEX `CustomerPOLine_poId_idx`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequirementSheet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesOrderId` INTEGER NOT NULL,
    `periodKey` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
    `remarks` VARCHAR(191) NULL,
    `recalculatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequirementSheet_salesOrderId_idx`(`salesOrderId`),
    INDEX `RequirementSheet_periodKey_idx`(`periodKey`),
    INDEX `RequirementSheet_status_idx`(`status`),
    UNIQUE INDEX `RequirementSheet_salesOrderId_periodKey_version_key`(`salesOrderId`, `periodKey`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RequirementSheetLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sheetId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `requirementQty` DECIMAL(18, 3) NOT NULL,
    `availableStockQtySnapshot` DECIMAL(18, 3) NULL,
    `gapPercentSnapshot` DECIMAL(18, 2) NULL,
    `suggestedWoQtySnapshot` DECIMAL(18, 3) NULL,
    `colorZoneSnapshot` ENUM('GREEN', 'YELLOW', 'RED', 'EXCESS') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequirementSheetLine_sheetId_idx`(`sheetId`),
    INDEX `RequirementSheetLine_itemId_idx`(`itemId`),
    UNIQUE INDEX `RequirementSheetLine_sheetId_itemId_key`(`sheetId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesBill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billNo` VARCHAR(128) NULL,
    `billDate` DATE NOT NULL,
    `customerId` INTEGER NOT NULL,
    `dispatchId` INTEGER NOT NULL,
    `remarks` TEXT NULL,
    `status` ENUM('DRAFT', 'FINALIZED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `customerNameSnapshot` VARCHAR(256) NOT NULL DEFAULT '',
    `customerStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
    `customerStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '',
    `dispatchNoSnapshot` VARCHAR(64) NOT NULL DEFAULT '',
    `dispatchDateSnapshot` DATETIME(3) NULL,
    `soIdSnapshot` INTEGER NULL,
    `isExported` BOOLEAN NOT NULL DEFAULT false,
    `exportedAt` DATETIME(3) NULL,
    `exportedFileName` VARCHAR(255) NULL,
    `exportedById` INTEGER NULL,
    `exportResetAt` DATETIME(3) NULL,
    `exportResetReason` TEXT NULL,
    `exportResetById` INTEGER NULL,
    `finalizedAt` DATETIME(3) NULL,
    `finalizedById` INTEGER NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` INTEGER NULL,
    `cancelReason` TEXT NULL,
    `totalBasic` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalCgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalSgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalIgst` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `totalTax` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesBill_billDate_idx`(`billDate`),
    INDEX `SalesBill_status_idx`(`status`),
    INDEX `SalesBill_customerId_idx`(`customerId`),
    INDEX `SalesBill_dispatchId_idx`(`dispatchId`),
    INDEX `SalesBill_isExported_idx`(`isExported`),
    INDEX `SalesBill_exportedById_idx`(`exportedById`),
    INDEX `SalesBill_exportResetById_idx`(`exportResetById`),
    INDEX `SalesBill_finalizedById_idx`(`finalizedById`),
    INDEX `SalesBill_cancelledById_idx`(`cancelledById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesBillLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesBillId` INTEGER NOT NULL,
    `dispatchId` INTEGER NULL,
    `soId` INTEGER NULL,
    `itemId` INTEGER NOT NULL,
    `itemNameSnapshot` VARCHAR(256) NOT NULL DEFAULT '',
    `hsnCodeSnapshot` VARCHAR(32) NOT NULL DEFAULT '',
    `unitSnapshot` VARCHAR(64) NOT NULL DEFAULT '',
    `qty` DECIMAL(18, 3) NOT NULL,
    `rate` DECIMAL(18, 4) NOT NULL,
    `basicAmount` DECIMAL(18, 2) NOT NULL,
    `gstRate` DECIMAL(5, 2) NOT NULL,
    `cgstAmount` DECIMAL(18, 2) NOT NULL,
    `sgstAmount` DECIMAL(18, 2) NOT NULL,
    `igstAmount` DECIMAL(18, 2) NOT NULL,
    `lineTotal` DECIMAL(18, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SalesBillLine_salesBillId_idx`(`salesBillId`),
    INDEX `SalesBillLine_itemId_idx`(`itemId`),
    INDEX `SalesBillLine_dispatchId_idx`(`dispatchId`),
    INDEX `SalesBillLine_soId_idx`(`soId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockAdjustmentQcEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stockTransactionId` INTEGER NOT NULL,
    `salesOrderId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `acceptedQty` DECIMAL(18, 3) NOT NULL,
    `rejectedQty` DECIMAL(18, 3) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reversedAt` DATETIME(3) NULL,
    `reversalReason` VARCHAR(191) NULL,

    INDEX `StockAdjustmentQcEntry_stockTransactionId_idx`(`stockTransactionId`),
    INDEX `StockAdjustmentQcEntry_salesOrderId_itemId_idx`(`salesOrderId`, `itemId`),
    INDEX `StockAdjustmentQcEntry_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PurchaseBill_isExported_idx` ON `PurchaseBill`(`isExported`);

-- CreateIndex
CREATE INDEX `PurchaseBill_exportResetById_idx` ON `PurchaseBill`(`exportResetById`);

-- CreateIndex
CREATE UNIQUE INDEX `Quotation_quotationNo_key` ON `Quotation`(`quotationNo`);

-- CreateIndex
CREATE INDEX `Quotation_workflowStatus_idx` ON `Quotation`(`workflowStatus`);

-- CreateIndex
CREATE INDEX `Quotation_approvalCancelledByUserId_idx` ON `Quotation`(`approvalCancelledByUserId`);

-- CreateIndex
CREATE INDEX `RmPurchaseOrder_supplierId_idx` ON `RmPurchaseOrder`(`supplierId`);

-- CreateIndex
CREATE UNIQUE INDEX `SalesOrder_quotationId_key` ON `SalesOrder`(`quotationId`);

-- CreateIndex
CREATE INDEX `SalesOrder_customerId_idx` ON `SalesOrder`(`customerId`);

-- CreateIndex
CREATE INDEX `SalesOrder_internalStatus_idx` ON `SalesOrder`(`internalStatus`);

-- CreateIndex
CREATE INDEX `Supplier_stateCode_idx` ON `Supplier`(`stateCode`);

-- CreateIndex
CREATE INDEX `WorkOrder_salesOrderId_idx` ON `WorkOrder`(`salesOrderId`);

-- AddForeignKey
ALTER TABLE `EnquiryLine` ADD CONSTRAINT `EnquiryLine_enquiryId_fkey` FOREIGN KEY (`enquiryId`) REFERENCES `Enquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EnquiryLine` ADD CONSTRAINT `EnquiryLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Quotation` ADD CONSTRAINT `Quotation_approvalCancelledByUserId_fkey` FOREIGN KEY (`approvalCancelledByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerPO` ADD CONSTRAINT `CustomerPO_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerPOLine` ADD CONSTRAINT `CustomerPOLine_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `CustomerPO`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerPOLine` ADD CONSTRAINT `CustomerPOLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequirementSheet` ADD CONSTRAINT `RequirementSheet_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequirementSheetLine` ADD CONSTRAINT `RequirementSheetLine_sheetId_fkey` FOREIGN KEY (`sheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RequirementSheetLine` ADD CONSTRAINT `RequirementSheetLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_dispatchId_fkey` FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_exportResetById_fkey` FOREIGN KEY (`exportResetById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_exportedById_fkey` FOREIGN KEY (`exportedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_finalizedById_fkey` FOREIGN KEY (`finalizedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBill` ADD CONSTRAINT `SalesBill_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBillLine` ADD CONSTRAINT `SalesBillLine_salesBillId_fkey` FOREIGN KEY (`salesBillId`) REFERENCES `SalesBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesBillLine` ADD CONSTRAINT `SalesBillLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RmPurchaseOrder` ADD CONSTRAINT `RmPurchaseOrder_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_exportResetById_fkey` FOREIGN KEY (`exportResetById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustmentQcEntry` ADD CONSTRAINT `StockAdjustmentQcEntry_stockTransactionId_fkey` FOREIGN KEY (`stockTransactionId`) REFERENCES `StockTransaction`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustmentQcEntry` ADD CONSTRAINT `StockAdjustmentQcEntry_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockAdjustmentQcEntry` ADD CONSTRAINT `StockAdjustmentQcEntry_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `salesorder` RENAME INDEX `SalesOrder_customerReturnId_unique` TO `SalesOrder_customerReturnId_key`;
