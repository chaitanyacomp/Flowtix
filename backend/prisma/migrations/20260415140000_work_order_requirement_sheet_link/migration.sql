-- Add link from WorkOrder → RequirementSheet (NO_QTY one-click WO creation).
-- Prevent duplicate WO creation for the same locked sheet version.

-- AlterTable
ALTER TABLE `WorkOrder` ADD COLUMN `requirementSheetId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `WorkOrder_requirementSheetId_key` ON `WorkOrder`(`requirementSheetId`);

-- AddForeignKey
ALTER TABLE `WorkOrder` ADD CONSTRAINT `WorkOrder_requirementSheetId_fkey`
FOREIGN KEY (`requirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

