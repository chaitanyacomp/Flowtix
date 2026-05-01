-- Document numbers (docNo) + DocSequence — aligns DB with schema.prisma (was never included in earlier migrations).

-- CreateTable
CREATE TABLE `DocSequence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `docType` ENUM('SALES_ORDER', 'WORK_ORDER', 'PRODUCTION_ENTRY', 'QC_ENTRY', 'DISPATCH', 'SALES_BILL', 'REQUIREMENT_SHEET') NOT NULL,
    `year2` INTEGER NOT NULL,
    `nextNumber` INTEGER NOT NULL,

    INDEX `DocSequence_docType_year2_idx`(`docType`, `year2`),
    UNIQUE INDEX `DocSequence_docType_year2_key`(`docType`, `year2`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `dispatch` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `productionentry` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `qcentry` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `requirementsheet` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `salesbill` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `salesorder` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `workorder` ADD COLUMN `docNo` VARCHAR(32) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Dispatch_docNo_key` ON `dispatch`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `ProductionEntry_docNo_key` ON `productionentry`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `QcEntry_docNo_key` ON `qcentry`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `RequirementSheet_docNo_key` ON `requirementsheet`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `SalesBill_docNo_key` ON `salesbill`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `SalesOrder_docNo_key` ON `salesorder`(`docNo`);

-- CreateIndex
CREATE UNIQUE INDEX `WorkOrder_docNo_key` ON `workorder`(`docNo`);
