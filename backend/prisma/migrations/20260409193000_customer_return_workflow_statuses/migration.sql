-- CustomerReturn explicit workflow routing statuses.
-- NOTE: This project uses manual SQL migrations due to Prisma drift in dev DB history.

-- Step 1: expand enum to include both legacy + new values (prevents truncation).
ALTER TABLE `CustomerReturn`
  MODIFY `status` ENUM(
    'ACTIVE',
    'QC_PENDING',
    'CLOSED',
    'SCRAPPED',
    'IN_REWORK',
    'IN_QC_HOLD',
    'APPROVED_TO_STOCK',
    'REVERSED'
  ) NOT NULL DEFAULT 'IN_QC_HOLD';

-- Backfill existing rows to the new routing statuses.
UPDATE `CustomerReturn`
SET `status` = 'REVERSED'
WHERE `reversedAt` IS NOT NULL;

UPDATE `CustomerReturn`
SET `status` = 'SCRAPPED'
WHERE `reversedAt` IS NULL
  AND `status` = 'SCRAPPED';

UPDATE `CustomerReturn`
SET `status` = 'IN_REWORK'
WHERE `reversedAt` IS NULL
  AND `status` NOT IN ('REVERSED', 'SCRAPPED')
  AND `currentBucket` = 'REWORK';

UPDATE `CustomerReturn`
SET `status` = 'IN_QC_HOLD'
WHERE `reversedAt` IS NULL
  AND `status` NOT IN ('REVERSED', 'SCRAPPED')
  AND `currentBucket` = 'QC_HOLD';

UPDATE `CustomerReturn`
SET `status` = 'APPROVED_TO_STOCK'
WHERE `reversedAt` IS NULL
  AND `status` NOT IN ('REVERSED', 'SCRAPPED')
  AND `currentBucket` = 'USABLE';

-- Step 3: shrink enum to the final workflow routing values only.
ALTER TABLE `CustomerReturn`
  MODIFY `status` ENUM(
    'IN_REWORK',
    'IN_QC_HOLD',
    'APPROVED_TO_STOCK',
    'SCRAPPED',
    'REVERSED'
  ) NOT NULL DEFAULT 'IN_QC_HOLD';

