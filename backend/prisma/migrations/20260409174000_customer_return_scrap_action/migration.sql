-- Refine customer return scrap flow:
-- - CustomerReturn: add currentBucket + status + closedAt
-- - Remove disposition 'SCRAP' by keeping existing rows as QC_HOLD and marking as SCRAPPED/closed.

ALTER TABLE `CustomerReturn`
  ADD COLUMN `currentBucket` ENUM('USABLE','QC_HOLD','REWORK') NULL,
  ADD COLUMN `status` ENUM('ACTIVE','SCRAPPED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN `closedAt` DATETIME(3) NULL;

-- Backfill currentBucket from old disposition.
UPDATE `CustomerReturn`
SET `currentBucket` = CASE
  WHEN `disposition` = 'TO_STOCK' THEN 'USABLE'
  WHEN `disposition` = 'REWORK' THEN 'REWORK'
  ELSE 'QC_HOLD'
END
WHERE `currentBucket` IS NULL;

-- If legacy rows had disposition SCRAP, consider them scrapped/closed (already posted SCRAP txn previously).
UPDATE `CustomerReturn`
SET `status` = 'SCRAPPED',
    `closedAt` = COALESCE(`closedAt`, `createdAt`),
    `disposition` = 'QC_HOLD'
WHERE `disposition` = 'SCRAP';

ALTER TABLE `CustomerReturn`
  MODIFY `currentBucket` ENUM('USABLE','QC_HOLD','REWORK') NOT NULL;

-- Shrink disposition enum (remove SCRAP)
ALTER TABLE `CustomerReturn`
  MODIFY `disposition` ENUM('QC_HOLD','REWORK','TO_STOCK') NOT NULL;

CREATE INDEX `CustomerReturn_status_idx` ON `CustomerReturn`(`status`);
CREATE INDEX `CustomerReturn_currentBucket_idx` ON `CustomerReturn`(`currentBucket`);

