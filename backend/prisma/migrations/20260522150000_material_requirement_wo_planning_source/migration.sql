-- Prepare Work Order: link Material Requirement to WO planning source + optional work order

ALTER TABLE `MaterialRequirement`
  ADD COLUMN `workOrderId` INT NULL,
  ADD INDEX `MaterialRequirement_workOrderId_idx`(`workOrderId`),
  ADD CONSTRAINT `MaterialRequirement_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MaterialRequirement`
  MODIFY `sourceType` ENUM('QUOTATION', 'SALES_ORDER', 'WORK_ORDER_PLANNING') NOT NULL;
