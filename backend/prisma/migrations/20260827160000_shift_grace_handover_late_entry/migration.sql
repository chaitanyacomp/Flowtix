-- Shift grace / handover / late-entry foundation (schema only).
-- Additive: HANDOVER_PENDING + session snapshots/overtime/cutoff + ProductionEntry late-entry audit.
-- openMachId remains unique only for OPEN (HANDOVER_PENDING does not occupy the machine).
-- enteredAt: ADD NULL with no default, then MODIFY default — never stamp historical ProductionEntry rows.
-- Session scheduled times: IST wall clock stored as UTC DATETIME (IST = +05:30, no DST).

-- A) Factory-wide grace (before and after scheduled start and end).
ALTER TABLE `AppSetting`
  ADD COLUMN `shiftGraceMinutes` INTEGER NOT NULL DEFAULT 15;

UPDATE `AppSetting`
SET `shiftGraceMinutes` = 15
WHERE `id` = 1;

-- B) Expand status enum and recreate openMachId (same pattern as CANCELLED).
-- 1) Drop unique index before recreating the generated column.
ALTER TABLE `MachineShiftSession` DROP INDEX `uq_mss_open`;

-- 2) Drop generated column (expression change requires drop + add on MySQL).
ALTER TABLE `MachineShiftSession` DROP COLUMN `openMachId`;

-- 3) Expand status enum (preserve OPEN / SHIFT_OVER / CANCELLED values).
ALTER TABLE `MachineShiftSession`
  MODIFY COLUMN `status` ENUM('OPEN', 'SHIFT_OVER', 'CANCELLED', 'HANDOVER_PENDING') NOT NULL DEFAULT 'OPEN';

-- C) Session scheduled / overtime / cutoff / handover / start-window fields.
ALTER TABLE `MachineShiftSession`
  ADD COLUMN `scheduledStartAt` DATETIME(3) NULL,
  ADD COLUMN `scheduledEndAt` DATETIME(3) NULL,
  ADD COLUMN `graceMinutesSnapshot` INTEGER NULL,
  ADD COLUMN `overtimeApprovedUntil` DATETIME(3) NULL,
  ADD COLUMN `overtimeApprovedAt` DATETIME(3) NULL,
  ADD COLUMN `overtimeApprovedByUserId` INTEGER NULL,
  ADD COLUMN `overtimeReason` TEXT NULL,
  ADD COLUMN `liveProductionStoppedAt` DATETIME(3) NULL,
  ADD COLUMN `timeEndDetectedAt` DATETIME(3) NULL,
  ADD COLUMN `actualOperationalEndAt` DATETIME(3) NULL,
  ADD COLUMN `previousSessionId` INTEGER NULL,
  ADD COLUMN `startedOutsideWindow` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `startedOutsideWindowReason` VARCHAR(40) NULL,
  ADD COLUMN `startedOutsideWindowRemarks` TEXT NULL;

-- 4) Recreate openMachId — only OPEN sessions reserve the machine.
ALTER TABLE `MachineShiftSession`
  ADD COLUMN `openMachId` INTEGER
    GENERATED ALWAYS AS (IF(`status` = 'OPEN', `machineId`, NULL)) VIRTUAL;

-- 5) Preserve unique open-session-per-machine constraint.
CREATE UNIQUE INDEX `uq_mss_open` ON `MachineShiftSession` (`openMachId`);

CREATE INDEX `idx_mss_ot_by` ON `MachineShiftSession` (`overtimeApprovedByUserId`);
CREATE INDEX `idx_mss_prev_sess` ON `MachineShiftSession` (`previousSessionId`);

ALTER TABLE `MachineShiftSession`
  ADD CONSTRAINT `mss_ot_by_user_fk` FOREIGN KEY (`overtimeApprovedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineShiftSession`
  ADD CONSTRAINT `mss_prev_sess_fk` FOREIGN KEY (`previousSessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill scheduled snapshots from sessionDate + Shift Master HH:mm.
-- Overnight: end < start → end is the next calendar day. Night shift sessionDate is the starting date.
-- Store UTC (IST wall clock minus 330 minutes). Leave snapshots null when Shift/time is unavailable.
-- Do not stamp liveProductionStoppedAt, timeEndDetectedAt, actualOperationalEndAt, or overtime fields.
UPDATE `MachineShiftSession` `s`
INNER JOIN `Shift` `sh` ON `sh`.`id` = `s`.`shiftId`
SET
  `s`.`scheduledStartAt` = DATE_SUB(
    STR_TO_DATE(CONCAT(DATE_FORMAT(`s`.`sessionDate`, '%Y-%m-%d'), ' ', `sh`.`startTime`, ':00'), '%Y-%m-%d %H:%i:%s'),
    INTERVAL 330 MINUTE
  ),
  `s`.`scheduledEndAt` = DATE_SUB(
    CASE
      WHEN TIME_TO_SEC(STR_TO_DATE(`sh`.`endTime`, '%H:%i')) < TIME_TO_SEC(STR_TO_DATE(`sh`.`startTime`, '%H:%i'))
      THEN DATE_ADD(
        STR_TO_DATE(CONCAT(DATE_FORMAT(`s`.`sessionDate`, '%Y-%m-%d'), ' ', `sh`.`endTime`, ':00'), '%Y-%m-%d %H:%i:%s'),
        INTERVAL 1 DAY
      )
      ELSE STR_TO_DATE(CONCAT(DATE_FORMAT(`s`.`sessionDate`, '%Y-%m-%d'), ' ', `sh`.`endTime`, ':00'), '%Y-%m-%d %H:%i:%s')
    END,
    INTERVAL 330 MINUTE
  ),
  `s`.`graceMinutesSnapshot` = 15
WHERE `s`.`shiftId` IS NOT NULL
  AND STR_TO_DATE(`sh`.`startTime`, '%H:%i') IS NOT NULL
  AND STR_TO_DATE(`sh`.`endTime`, '%H:%i') IS NOT NULL
  AND STR_TO_DATE(CONCAT(DATE_FORMAT(`s`.`sessionDate`, '%Y-%m-%d'), ' ', `sh`.`startTime`, ':00'), '%Y-%m-%d %H:%i:%s') IS NOT NULL
  AND STR_TO_DATE(CONCAT(DATE_FORMAT(`s`.`sessionDate`, '%Y-%m-%d'), ' ', `sh`.`endTime`, ':00'), '%Y-%m-%d %H:%i:%s') IS NOT NULL;

-- D) ProductionEntry late-entry audit.
-- enteredAt: ADD NULL with no default first so existing rows stay NULL.
ALTER TABLE `ProductionEntry`
  ADD COLUMN `enteredAt` DATETIME(3) NULL;

ALTER TABLE `ProductionEntry`
  ADD COLUMN `actualProductionAt` DATETIME(3) NULL,
  ADD COLUMN `createdByUserId` INTEGER NULL,
  ADD COLUMN `enteredOnBehalfOfOperatorId` INTEGER NULL,
  ADD COLUMN `operatorUnavailable` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lateEntryReason` VARCHAR(40) NULL,
  ADD COLUMN `lateEntryRemarks` TEXT NULL,
  ADD COLUMN `isLateManagerEntry` BOOLEAN NOT NULL DEFAULT false;

-- New inserts without an application value receive database time. Historical NULLs are unchanged.
ALTER TABLE `ProductionEntry`
  MODIFY COLUMN `enteredAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `Pe_createdBy_idx` ON `ProductionEntry` (`createdByUserId`);
CREATE INDEX `Pe_enteredOnBehalf_idx` ON `ProductionEntry` (`enteredOnBehalfOfOperatorId`);
CREATE INDEX `Pe_shiftSess_lateMgr_idx` ON `ProductionEntry` (`shiftSessionId`, `isLateManagerEntry`);

ALTER TABLE `ProductionEntry`
  ADD CONSTRAINT `Pe_createdBy_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionEntry`
  ADD CONSTRAINT `Pe_enteredOnBehalf_fkey` FOREIGN KEY (`enteredOnBehalfOfOperatorId`) REFERENCES `Operator`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
