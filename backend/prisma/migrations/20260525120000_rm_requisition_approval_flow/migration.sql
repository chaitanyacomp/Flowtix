-- RM Requisition approval lifecycle.
-- Keeps MaterialRequirement table name; changes business lifecycle and ownership gates only.

ALTER TABLE `MaterialRequirement`
  MODIFY `status` ENUM(
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED',
    'SENT_TO_PURCHASE',
    'PROCUREMENT_IN_PROGRESS',
    'PARTIALLY_PROCURED',
    'FULLY_PROCURED',
    'CLOSED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `requiredDate` DATE NULL,
  ADD COLUMN `raisedByUserId` INT NULL,
  ADD COLUMN `approvedByUserId` INT NULL,
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `sentToPurchaseAt` DATETIME(3) NULL,
  ADD COLUMN `closedAt` DATETIME(3) NULL,
  ADD COLUMN `requisitionRemarks` TEXT NULL,
  ADD COLUMN `approvalRemarks` TEXT NULL,
  ADD INDEX `MaterialRequirement_raisedByUserId_idx`(`raisedByUserId`),
  ADD INDEX `MaterialRequirement_approvedByUserId_idx`(`approvedByUserId`),
  ADD INDEX `MaterialRequirement_sentToPurchaseAt_idx`(`sentToPurchaseAt`);

ALTER TABLE `MaterialRequirement`
  ADD CONSTRAINT `MaterialRequirement_raisedByUserId_fkey`
    FOREIGN KEY (`raisedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `MaterialRequirement_approvedByUserId_fkey`
    FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing rows were previously procurement-visible DRAFTs. Classify them from downstream linkage.
UPDATE `MaterialRequirement` mr
SET
  mr.`raisedByUserId` = COALESCE(mr.`raisedByUserId`, mr.`createdByUserId`),
  mr.`requisitionRemarks` = COALESCE(mr.`requisitionRemarks`, mr.`remarks`);

UPDATE `MaterialRequirement` mr
SET mr.`status` = 'FULLY_PROCURED',
    mr.`closedAt` = COALESCE(mr.`closedAt`, NOW(3))
WHERE mr.`status` <> 'CANCELLED'
  AND EXISTS (
    SELECT 1
    FROM `MaterialRequirementLine` mrl
    WHERE mrl.`materialRequirementId` = mr.`id`
  )
  AND NOT EXISTS (
    SELECT 1
    FROM `MaterialRequirementLine` mrl
    WHERE mrl.`materialRequirementId` = mr.`id`
      AND COALESCE(mrl.`procuredQty`, 0) + 0.000001 < mrl.`shortageQty`
  );

UPDATE `MaterialRequirement` mr
SET mr.`status` = 'PROCUREMENT_IN_PROGRESS'
WHERE mr.`status` NOT IN ('CANCELLED', 'FULLY_PROCURED')
  AND EXISTS (
    SELECT 1
    FROM `MaterialRequirementLine` mrl
    JOIN `PurchaseRequestLineSourceLink` prsl ON prsl.`materialRequirementLineId` = mrl.`id`
    JOIN `PurchaseRequestLine` prl ON prl.`id` = prsl.`purchaseRequestLineId`
    JOIN `RmPoLineProcurementLink` pol ON pol.`purchaseRequestLineId` = prl.`id`
    WHERE mrl.`materialRequirementId` = mr.`id`
  );

UPDATE `MaterialRequirement` mr
SET mr.`status` = 'SENT_TO_PURCHASE',
    mr.`sentToPurchaseAt` = COALESCE(mr.`sentToPurchaseAt`, mr.`updatedAt`)
WHERE mr.`status` NOT IN ('CANCELLED', 'FULLY_PROCURED', 'PROCUREMENT_IN_PROGRESS')
  AND EXISTS (
    SELECT 1
    FROM `MaterialRequirementLine` mrl
    JOIN `PurchaseRequestLineSourceLink` prsl ON prsl.`materialRequirementLineId` = mrl.`id`
    WHERE mrl.`materialRequirementId` = mr.`id`
  );

UPDATE `MaterialRequirement` mr
SET mr.`status` = 'PARTIALLY_PROCURED'
WHERE mr.`status` = 'PROCUREMENT_IN_PROGRESS'
  AND EXISTS (
    SELECT 1
    FROM `MaterialRequirementLine` mrl
    WHERE mrl.`materialRequirementId` = mr.`id`
      AND COALESCE(mrl.`procuredQty`, 0) > 0
      AND COALESCE(mrl.`procuredQty`, 0) + 0.000001 < mrl.`shortageQty`
  );

UPDATE `MaterialRequirement` mr
SET mr.`status` = 'PENDING_APPROVAL'
WHERE mr.`status` = 'DRAFT';
