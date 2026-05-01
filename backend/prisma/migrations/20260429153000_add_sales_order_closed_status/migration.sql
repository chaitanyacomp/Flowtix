-- Ensure SalesOrder.internalStatus includes NO_QTY lifecycle statuses.
ALTER TABLE `SalesOrder`
  MODIFY `internalStatus` ENUM('DRAFT', 'OPEN', 'APPROVED', 'IN_PROCESS', 'COMPLETED', 'CLOSED') NOT NULL DEFAULT 'DRAFT';
