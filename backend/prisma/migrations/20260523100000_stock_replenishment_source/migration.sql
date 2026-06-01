-- Add isolated RM stock replenishment source for MaterialRequirement.

ALTER TABLE `MaterialRequirement`
  MODIFY `sourceType` ENUM('QUOTATION', 'SALES_ORDER', 'WORK_ORDER_PLANNING', 'STOCK_REPLENISHMENT') NOT NULL;
