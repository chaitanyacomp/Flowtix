-- P6B-1B: NO_QTY Requirement Sheet CANCELLED lifecycle (retain audit trail; no delete).

ALTER TABLE `RequirementSheet` MODIFY `status` ENUM('DRAFT', 'LOCKED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `RequirementSheet` ADD COLUMN `cancelledAt` DATETIME(3) NULL;
ALTER TABLE `RequirementSheet` ADD COLUMN `cancelledByUserId` INT NULL;
ALTER TABLE `RequirementSheet` ADD COLUMN `cancellationReason` TEXT NULL;

CREATE INDEX `RequirementSheet_cancelledAt_idx` ON `RequirementSheet`(`cancelledAt`);

ALTER TABLE `RequirementSheet` ADD CONSTRAINT `RequirementSheet_cancelledByUserId_fkey`
  FOREIGN KEY (`cancelledByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
