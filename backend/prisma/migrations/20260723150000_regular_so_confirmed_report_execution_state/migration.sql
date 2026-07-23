-- REGULAR_SO only: repair the pre-report execution parking state left behind
-- after an authoritative ProductionWorkOrderReport was confirmed.
UPDATE `WorkOrderProductionExecution` AS `execution`
INNER JOIN `WorkOrder` AS `wo`
  ON `wo`.`id` = `execution`.`workOrderId`
INNER JOIN `SalesOrder` AS `so`
  ON `so`.`id` = `wo`.`salesOrderId`
INNER JOIN `ProductionWorkOrderReport` AS `report`
  ON `report`.`workOrderId` = `wo`.`id`
  AND `report`.`status` = 'CONFIRMED'
SET
  `execution`.`executionStatus` = 'COMPLETED',
  `execution`.`completedAt` = COALESCE(`execution`.`completedAt`, `report`.`confirmedAt`),
  `execution`.`completedByUserId` = COALESCE(`execution`.`completedByUserId`, `report`.`confirmedByUserId`),
  `execution`.`blockReason` = NULL,
  `execution`.`blockRemarks` = 'REGULAR: Production Report confirmed. WO shortfall closure/reconciliation is separate.'
WHERE
  `execution`.`executionStatus` = 'SHORTFALL_PENDING'
  AND `wo`.`requirementSheetId` IS NULL
  AND `wo`.`cycleId` IS NULL
  AND `wo`.`monthlyProductionPlanId` IS NULL
  AND `wo`.`sourceType` = 'CUSTOMER_REQUIREMENT'
  AND `so`.`orderType` IN ('NORMAL', 'REPLACEMENT');
