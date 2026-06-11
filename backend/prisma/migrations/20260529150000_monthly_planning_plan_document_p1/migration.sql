-- Phase P1: Plan-document model foundation (multiple plans per period, purchase review lifecycle).
-- Legacy LOCKED status and revision columns are retained for backward compatibility.

-- Extend plan status enum (keep LOCKED for legacy rows).
ALTER TABLE `MonthlyProductionPlan`
  MODIFY `status` ENUM(
    'DRAFT',
    'AWAITING_PURCHASE_REVIEW',
    'APPROVED',
    'LOCKED'
  ) NOT NULL DEFAULT 'DRAFT';

-- Plan-document identity within a period.
ALTER TABLE `MonthlyProductionPlan`
  ADD COLUMN `planSequenceNo` INTEGER NOT NULL DEFAULT 1 AFTER `periodKey`,
  ADD COLUMN `planKind` ENUM('INITIAL', 'ADDITIONAL') NOT NULL DEFAULT 'INITIAL' AFTER `planSequenceNo`,
  ADD COLUMN `purchaseReviewedAt` DATETIME(3) NULL AFTER `reopenedByUserId`,
  ADD COLUMN `purchaseReviewedByUserId` INTEGER NULL AFTER `purchaseReviewedAt`,
  ADD COLUMN `approvedAt` DATETIME(3) NULL AFTER `purchaseReviewedByUserId`,
  ADD COLUMN `approvedByUserId` INTEGER NULL AFTER `approvedAt`,
  ADD COLUMN `purchaseRejectReason` TEXT NULL AFTER `approvedByUserId`;

-- Backfill existing rows as Plan 1 / INITIAL (idempotent for fresh installs).
UPDATE `MonthlyProductionPlan`
SET `planSequenceNo` = 1, `planKind` = 'INITIAL'
WHERE `planSequenceNo` IS NULL OR `planSequenceNo` < 1;

-- Replace one-plan-per-period with sequence uniqueness.
DROP INDEX `MonthlyProductionPlan_periodKey_key` ON `MonthlyProductionPlan`;
CREATE UNIQUE INDEX `MonthlyProductionPlan_periodKey_planSequenceNo_key`
  ON `MonthlyProductionPlan`(`periodKey`, `planSequenceNo`);
CREATE INDEX `MonthlyProductionPlan_periodKey_status_idx`
  ON `MonthlyProductionPlan`(`periodKey`, `status`);

-- Purchase review / approval actor FKs.
ALTER TABLE `MonthlyProductionPlan`
  ADD CONSTRAINT `MonthlyProductionPlan_purchaseReviewedByUserId_fkey`
    FOREIGN KEY (`purchaseReviewedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `MonthlyProductionPlan_approvedByUserId_fkey`
    FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
