-- Ensure one-to-one relation for SalesOrder.currentCycleId
-- Prisma requires currentCycleId to be unique on SalesOrder.

CREATE UNIQUE INDEX `SalesOrder_currentCycleId_key` ON `SalesOrder`(`currentCycleId`);

