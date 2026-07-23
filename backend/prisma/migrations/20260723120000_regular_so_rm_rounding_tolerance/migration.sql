-- REGULAR_SO: operational rounding-tolerance short-close reason + PMR acknowledgement audit fields.
ALTER TABLE `ProductionMaterialRequest`
  ADD COLUMN `shortIssueCloseReason` ENUM(
    'SCALE_LIMITATION',
    'PACKING_LIMITATION',
    'MANAGEMENT_DECISION',
    'ROUNDING_TOLERANCE',
    'OTHER'
  ) NULL,
  ADD COLUMN `shortIssueClosedAt` DATETIME(3) NULL,
  ADD COLUMN `shortIssueClosedByUserId` INT NULL;

CREATE INDEX `ProductionMaterialRequest_shortIssueClosedByUserId_idx`
  ON `ProductionMaterialRequest`(`shortIssueClosedByUserId`);

ALTER TABLE `ProductionMaterialRequest`
  ADD CONSTRAINT `ProductionMaterialRequest_shortIssueClosedByUserId_fkey`
  FOREIGN KEY (`shortIssueClosedByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
