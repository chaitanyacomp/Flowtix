-- Add QC_PENDING to CustomerReturn.status enum.

ALTER TABLE `CustomerReturn`
  MODIFY `status` ENUM('ACTIVE','QC_PENDING','SCRAPPED','CLOSED') NOT NULL DEFAULT 'ACTIVE';

