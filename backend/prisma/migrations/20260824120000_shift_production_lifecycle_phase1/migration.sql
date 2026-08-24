-- Phase 1 — Shift Production lifecycle DB foundation
-- Additive + backward-compatible: new tables and nullable links only.

ALTER TABLE `productionentry`
  ADD COLUMN `shiftRunSegmentId` INTEGER NULL,
  ADD COLUMN `shiftSessionId` INTEGER NULL;

CREATE INDEX `Pe_shiftSess_idx` ON `ProductionEntry`(`shiftSessionId`);
CREATE INDEX `Pe_shiftSeg_idx` ON `ProductionEntry`(`shiftRunSegmentId`);

CREATE TABLE `MachineShiftSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machineId` INTEGER NOT NULL,
    `shiftId` INTEGER NULL,
    `sessionDate` DATE NOT NULL,
    `shiftSessionNo` VARCHAR(32) NOT NULL,
    `status` ENUM('OPEN', 'SHIFT_OVER') NOT NULL DEFAULT 'OPEN',
    `handoverState` ENUM('RETAINED', 'CLEARED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `handoverRemarks` TEXT NULL,
    `primaryOperatorId` INTEGER NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `startedByUserId` INTEGER NULL,
    `endedAt` DATETIME(3) NULL,
    `endedByUserId` INTEGER NULL,
    `reopenCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `openMachId` INTEGER GENERATED ALWAYS AS (IF(`status` <> 'SHIFT_OVER', `machineId`, NULL)) VIRTUAL,

    UNIQUE INDEX `MachineShiftSession_shiftSessionNo_key`(`shiftSessionNo`),
    UNIQUE INDEX `uq_mss_open`(`openMachId`),
    UNIQUE INDEX `uq_mss_id_mach`(`id`, `machineId`),
    INDEX `idx_mss_mach_date`(`machineId`, `sessionDate`),
    INDEX `idx_mss_end_by`(`endedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineShiftSessionOperator` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `operatorId` INTEGER NOT NULL,
    `isPrimarySnapshot` BOOLEAN NOT NULL DEFAULT false,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `joinedLeaveReason` TEXT NULL,
    `changedByUserId` INTEGER NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_mssop_sid_op`(`sessionId`, `operatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineShiftSessionRunSegment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `runAllocationId` INTEGER NULL,
    `workOrderId` INTEGER NULL,
    `segmentNo` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `segmentStartedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `segmentStartedByUserId` INTEGER NULL,
    `closedAt` DATETIME(3) NULL,
    `closedByUserId` INTEGER NULL,
    `closeReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_mssseg_sid_m`(`sessionId`, `machineId`),
    INDEX `idx_mssseg_mach`(`machineId`),
    INDEX `idx_mssseg_run`(`runAllocationId`),
    INDEX `idx_mssseg_closed_by`(`closedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineShiftDowntimeIncident` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machineId` INTEGER NOT NULL,
    `runSegmentId` INTEGER NULL,
    `reason` ENUM('MACHINE_BREAKDOWN', 'WAITING_FOR_RM', 'TOOL_MOULD_MAINTENANCE', 'QUALITY_CONCERN', 'EMERGENCY_PRIORITY_PRODUCTION', 'POWER_UTILITY_FAILURE', 'MANAGEMENT_HOLD', 'OTHER') NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `startedByUserId` INTEGER NULL,
    `endedByUserId` INTEGER NULL,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_mssdo_mstart`(`machineId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineShiftDowntimeSegment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `incidentId` INTEGER NOT NULL,
    `segmentStartAt` DATETIME(3) NOT NULL,
    `segmentEndAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_mssds_sid`(`sessionId`),
    UNIQUE INDEX `uniq_mssds_inc_sid`(`incidentId`, `sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftProductionReport` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `latestVersionNo` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShiftProductionReport_sessionId_key`(`sessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftProductionReportVersion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportId` INTEGER NOT NULL,
    `versionNo` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED') NOT NULL DEFAULT 'DRAFT',
    `previousVersionId` INTEGER NULL,
    `declaredOperatorId` INTEGER NULL,
    `declaredByUserId` INTEGER NULL,
    `declaredAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `submittedByUserId` INTEGER NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verifiedByUserId` INTEGER NULL,
    `returnedAt` DATETIME(3) NULL,
    `returnedByUserId` INTEGER NULL,
    `returnReason` TEXT NULL,
    `grossOutputQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `productionScrapQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `qtySentToQc` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_srpt_ver_stat`(`reportId`, `status`),
    UNIQUE INDEX `uniq_srpt_ver`(`reportId`, `versionNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftProductionReportVersionLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportVersionId` INTEGER NOT NULL,
    `runSegmentId` INTEGER NULL,
    `itemId` INTEGER NOT NULL,
    `grossOutputQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `productionScrapQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `qtySentToQc` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_srp_line_rv`(`reportVersionId`),
    INDEX `idx_srp_line_item`(`itemId`),
    UNIQUE INDEX `uniq_srp_line`(`reportVersionId`, `runSegmentId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftSessionReopenRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `requestedByUserId` INTEGER NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reopenReason` TEXT NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'DENIED') NOT NULL DEFAULT 'REQUESTED',
    `decidedByUserId` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `idx_sess_reopen`(`sessionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftProductionReportAdjustmentRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reportVersionId` INTEGER NOT NULL,
    `requestedByUserId` INTEGER NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `adjustReason` TEXT NOT NULL,
    `proposedGrossOutputQty` DECIMAL(18, 3) NOT NULL,
    `proposedProductionScrapQty` DECIMAL(18, 3) NOT NULL,
    `proposedQtySentToQc` DECIMAL(18, 3) NOT NULL,
    `status` ENUM('REQUESTED', 'APPROVED', 'DENIED', 'APPLIED') NOT NULL DEFAULT 'REQUESTED',
    `decidedByUserId` INTEGER NULL,
    `decidedAt` DATETIME(3) NULL,
    `decisionNote` TEXT NULL,
    `appliedAt` DATETIME(3) NULL,
    `appliedByUserId` INTEGER NULL,
    `appliedReportVersionId` INTEGER NULL,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `unresVerId` INTEGER GENERATED ALWAYS AS (IF(`status` IN ('REQUESTED', 'APPROVED'), `reportVersionId`, NULL)) VIRTUAL,

    UNIQUE INDEX `uniq_srpt_adj_app_ver`(`appliedReportVersionId`),
    UNIQUE INDEX `uq_srpt_adj_unres`(`unresVerId`),
    INDEX `idx_srpt_adj`(`reportVersionId`, `status`),
    INDEX `idx_srpt_adj_by`(`appliedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftProductionReportAdjustmentLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adjustmentRequestId` INTEGER NOT NULL,
    `runSegmentId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `grossOutputQty` DECIMAL(18, 3) NOT NULL,
    `productionScrapQty` DECIMAL(18, 3) NOT NULL,
    `qtySentToQc` DECIMAL(18, 3) NOT NULL,
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uniq_srpt_adj_ln`(`adjustmentRequestId`, `runSegmentId`, `itemId`),
    INDEX `idx_srpt_adj_ln_req`(`adjustmentRequestId`),
    INDEX `idx_srpt_adj_ln_seg`(`runSegmentId`),
    INDEX `idx_srpt_adj_ln_item`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MachineShiftSession` ADD CONSTRAINT `MachineShiftSession_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSession` ADD CONSTRAINT `MachineShiftSession_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSession` ADD CONSTRAINT `MachineShiftSession_primaryOperatorId_fkey` FOREIGN KEY (`primaryOperatorId`) REFERENCES `Operator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSession` ADD CONSTRAINT `MachineShiftSession_startedByUserId_fkey` FOREIGN KEY (`startedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSession` ADD CONSTRAINT `MachineShiftSession_endedByUserId_fkey` FOREIGN KEY (`endedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineShiftSessionOperator` ADD CONSTRAINT `MachineShiftSessionOperator_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSessionOperator` ADD CONSTRAINT `MachineShiftSessionOperator_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `Operator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSessionOperator` ADD CONSTRAINT `MachineShiftSessionOperator_changedByUserId_fkey` FOREIGN KEY (`changedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineShiftSessionRunSegment` ADD CONSTRAINT `mssseg_sess_mach_fk` FOREIGN KEY (`sessionId`, `machineId`) REFERENCES `MachineShiftSession`(`id`, `machineId`) ON DELETE CASCADE ON UPDATE CASCADE;
-- One ACTIVE run segment per machine (DB-only generated column; not in Prisma schema).
-- VIRTUAL (not STORED): InnoDB rejects STORED generated columns based on `machineId`
-- when `machineId` is already part of composite FK `mssseg_sess_mach_fk` on this table.
-- Must be added AFTER the composite FK for the same reason at CREATE TABLE time.
ALTER TABLE `MachineShiftSessionRunSegment`
  ADD COLUMN `actMachId` INTEGER GENERATED ALWAYS AS (IF(`status` = 'ACTIVE', `machineId`, NULL)) VIRTUAL,
  ADD UNIQUE INDEX `uq_mssseg_act`(`actMachId`);
ALTER TABLE `MachineShiftSessionRunSegment` ADD CONSTRAINT `MachineShiftSessionRunSegment_runAllocationId_fkey` FOREIGN KEY (`runAllocationId`) REFERENCES `WorkOrderProductionRunAllocation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSessionRunSegment` ADD CONSTRAINT `MachineShiftSessionRunSegment_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSessionRunSegment` ADD CONSTRAINT `MachineShiftSessionRunSegment_segmentStartedByUserId_fkey` FOREIGN KEY (`segmentStartedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftSessionRunSegment` ADD CONSTRAINT `MachineShiftSessionRunSegment_closedByUserId_fkey` FOREIGN KEY (`closedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineShiftDowntimeIncident` ADD CONSTRAINT `MachineShiftDowntimeIncident_machineId_fkey` FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MachineShiftDowntimeIncident` ADD CONSTRAINT `MachineShiftDowntimeIncident_runSegmentId_fkey` FOREIGN KEY (`runSegmentId`) REFERENCES `MachineShiftSessionRunSegment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftDowntimeIncident` ADD CONSTRAINT `MachineShiftDowntimeIncident_startedByUserId_fkey` FOREIGN KEY (`startedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MachineShiftDowntimeIncident` ADD CONSTRAINT `MachineShiftDowntimeIncident_endedByUserId_fkey` FOREIGN KEY (`endedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineShiftDowntimeSegment` ADD CONSTRAINT `MachineShiftDowntimeSegment_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MachineShiftDowntimeSegment` ADD CONSTRAINT `MachineShiftDowntimeSegment_incidentId_fkey` FOREIGN KEY (`incidentId`) REFERENCES `MachineShiftDowntimeIncident`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ShiftProductionReport` ADD CONSTRAINT `ShiftProductionReport_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ShiftProductionReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_previousVersionId_fkey` FOREIGN KEY (`previousVersionId`) REFERENCES `ShiftProductionReportVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_declaredOperatorId_fkey` FOREIGN KEY (`declaredOperatorId`) REFERENCES `Operator`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftRptVer_declaredBy` FOREIGN KEY (`declaredByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_submittedByUserId_fkey` FOREIGN KEY (`submittedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_verifiedByUserId_fkey` FOREIGN KEY (`verifiedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersion` ADD CONSTRAINT `ShiftProductionReportVersion_returnedByUserId_fkey` FOREIGN KEY (`returnedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ShiftProductionReportVersionLine` ADD CONSTRAINT `ShiftProductionReportVersionLine_reportVersionId_fkey` FOREIGN KEY (`reportVersionId`) REFERENCES `ShiftProductionReportVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersionLine` ADD CONSTRAINT `ShiftProductionReportVersionLine_runSegmentId_fkey` FOREIGN KEY (`runSegmentId`) REFERENCES `MachineShiftSessionRunSegment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportVersionLine` ADD CONSTRAINT `ShiftProductionReportVersionLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ShiftSessionReopenRequest` ADD CONSTRAINT `ShiftSessionReopenRequest_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShiftSessionReopenRequest` ADD CONSTRAINT `ShiftSessionReopenRequest_requestedByUserId_fkey` FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftSessionReopenRequest` ADD CONSTRAINT `ShiftSessionReopenRequest_decidedByUserId_fkey` FOREIGN KEY (`decidedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ShiftProductionReportAdjustmentRequest` ADD CONSTRAINT `srpt_adj_tgt_ver_fk` FOREIGN KEY (`reportVersionId`) REFERENCES `ShiftProductionReportVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentRequest` ADD CONSTRAINT `srpt_adj_app_ver_fk` FOREIGN KEY (`appliedReportVersionId`) REFERENCES `ShiftProductionReportVersion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentRequest` ADD CONSTRAINT `srpt_adj_req_by_fk` FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentRequest` ADD CONSTRAINT `srpt_adj_dec_by_fk` FOREIGN KEY (`decidedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentRequest` ADD CONSTRAINT `srpt_adj_app_by_fk` FOREIGN KEY (`appliedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ShiftProductionReportAdjustmentLine` ADD CONSTRAINT `srpt_adj_ln_req_fk` FOREIGN KEY (`adjustmentRequestId`) REFERENCES `ShiftProductionReportAdjustmentRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentLine` ADD CONSTRAINT `srpt_adj_ln_seg_fk` FOREIGN KEY (`runSegmentId`) REFERENCES `MachineShiftSessionRunSegment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ShiftProductionReportAdjustmentLine` ADD CONSTRAINT `srpt_adj_ln_item_fk` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_shiftSessionId_fkey` FOREIGN KEY (`shiftSessionId`) REFERENCES `MachineShiftSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ProductionEntry` ADD CONSTRAINT `ProductionEntry_shiftRunSegmentId_fkey` FOREIGN KEY (`shiftRunSegmentId`) REFERENCES `MachineShiftSessionRunSegment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
