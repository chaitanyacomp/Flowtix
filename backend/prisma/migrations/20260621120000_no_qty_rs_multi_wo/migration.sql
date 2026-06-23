-- P10-A3: NO_QTY RS execution supports one RequirementSheet -> many WorkOrders.
-- Keep WorkOrder.requirementSheetId nullable; replace the unique index with non-unique lookup indexes.

CREATE INDEX `WorkOrder_requirementSheetId_idx` ON `WorkOrder`(`requirementSheetId`);
CREATE INDEX `WorkOrder_requirementSheetId_status_idx` ON `WorkOrder`(`requirementSheetId`, `status`);

DROP INDEX `WorkOrder_requirementSheetId_key` ON `WorkOrder`;
