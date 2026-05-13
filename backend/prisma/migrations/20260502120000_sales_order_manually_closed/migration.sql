-- NO_QTY: distinguish user SO close from cycle close. Cycles use SalesOrderCycle.status.

ALTER TABLE `SalesOrder` MODIFY `internalStatus` ENUM(
  'DRAFT',
  'OPEN',
  'APPROVED',
  'IN_PROCESS',
  'COMPLETED',
  'CLOSED',
  'MANUALLY_CLOSED'
) NOT NULL DEFAULT 'DRAFT';

-- Heal: auto-close had set NO_QTY SOs to CLOSED; they should stay open for the next cycle/RS.
-- (Any user who had manually closed via the old /close API will need to Close SO again to reach MANUALLY_CLOSED.)
UPDATE `SalesOrder`
SET `internalStatus` = 'IN_PROCESS'
WHERE `orderType` = 'NO_QTY' AND `internalStatus` = 'CLOSED';
