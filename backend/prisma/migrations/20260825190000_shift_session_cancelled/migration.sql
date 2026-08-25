-- Controlled cancellation of mistakenly started shift sessions.
-- Additive: CANCELLED status + cancellationReason; openMachId only for OPEN.

-- 1) Drop unique index before recreating the generated column.
ALTER TABLE `MachineShiftSession` DROP INDEX `uq_mss_open`;

-- 2) Drop generated column (expression change requires drop + add on MySQL).
ALTER TABLE `MachineShiftSession` DROP COLUMN `openMachId`;

-- 3) Expand status enum (preserve OPEN / SHIFT_OVER values).
ALTER TABLE `MachineShiftSession`
  MODIFY COLUMN `status` ENUM('OPEN', 'SHIFT_OVER', 'CANCELLED') NOT NULL DEFAULT 'OPEN';

-- 4) Cancellation audit reason (mandatory in service layer).
ALTER TABLE `MachineShiftSession`
  ADD COLUMN `cancellationReason` TEXT NULL;

-- 5) Recreate openMachId — only OPEN sessions reserve the machine.
ALTER TABLE `MachineShiftSession`
  ADD COLUMN `openMachId` INTEGER
    GENERATED ALWAYS AS (IF(`status` = 'OPEN', `machineId`, NULL)) VIRTUAL;

-- 6) Preserve unique open-session-per-machine constraint.
CREATE UNIQUE INDEX `uq_mss_open` ON `MachineShiftSession` (`openMachId`);
