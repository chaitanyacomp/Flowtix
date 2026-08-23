-- Persist explicit Complete Machine Planning handoff (valid runs alone are not enough).
ALTER TABLE `RegularSoPlanningSnapshot`
  ADD COLUMN `machinePlanningCompleted` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `machinePlanningCompletedAt` DATETIME(3) NULL,
  ADD COLUMN `machinePlanningCompletedByUserId` INTEGER NULL;

CREATE INDEX `RegularSoPlanningSnapshot_machinePlanningCompletedByUserId_idx`
  ON `RegularSoPlanningSnapshot`(`machinePlanningCompletedByUserId`);

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD CONSTRAINT `RegularSoPlanningSnapshot_machinePlanningCompletedByUserId_fkey`
  FOREIGN KEY (`machinePlanningCompletedByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
