ALTER TABLE `WorkOrder`
  MODIFY `salesOrderId` INTEGER NULL,
  ADD COLUMN `sourceType` ENUM('CUSTOMER_REQUIREMENT', 'GREEN_LEVEL_REPLENISHMENT') NOT NULL DEFAULT 'CUSTOMER_REQUIREMENT',
  ADD COLUMN `monthlyProductionPlanId` INTEGER NULL;

CREATE INDEX `WorkOrder_sourceType_idx` ON `WorkOrder`(`sourceType`);
CREATE INDEX `WorkOrder_monthlyProductionPlanId_idx` ON `WorkOrder`(`monthlyProductionPlanId`);
CREATE INDEX `WorkOrder_sourceType_monthlyProductionPlanId_idx` ON `WorkOrder`(`sourceType`, `monthlyProductionPlanId`);

ALTER TABLE `WorkOrder`
  ADD CONSTRAINT `WorkOrder_monthlyProductionPlanId_fkey`
  FOREIGN KEY (`monthlyProductionPlanId`) REFERENCES `MonthlyProductionPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
