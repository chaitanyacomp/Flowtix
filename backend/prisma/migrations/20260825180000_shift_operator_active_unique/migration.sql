-- Additive: one active operator participation across all sessions (leftAt IS NULL).
-- Mirrors openMachId / actMachId pattern (VIRTUAL generated + UNIQUE).
-- Requires Shift Over / leave / change-primary to stamp leftAt before another join.

ALTER TABLE `MachineShiftSessionOperator`
  ADD COLUMN `activeOpId` INTEGER
    GENERATED ALWAYS AS (IF(`leftAt` IS NULL, `operatorId`, NULL)) VIRTUAL;

CREATE UNIQUE INDEX `uq_mssop_active_op` ON `MachineShiftSessionOperator` (`activeOpId`);
