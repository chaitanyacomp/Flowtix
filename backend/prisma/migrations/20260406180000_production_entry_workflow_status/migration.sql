-- Draft → Approved production gating. Existing rows are treated as already approved (backward compatible).
ALTER TABLE `ProductionEntry` ADD COLUMN `workflowStatus` ENUM('DRAFT', 'APPROVED') NOT NULL DEFAULT 'APPROVED';

UPDATE `ProductionEntry` SET `workflowStatus` = 'APPROVED';

ALTER TABLE `ProductionEntry` ALTER COLUMN `workflowStatus` SET DEFAULT 'DRAFT';

CREATE INDEX `ProductionEntry_workflowStatus_idx` ON `ProductionEntry`(`workflowStatus`);
