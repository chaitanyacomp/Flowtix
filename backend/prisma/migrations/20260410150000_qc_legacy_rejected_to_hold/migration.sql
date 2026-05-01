-- Legacy QC: rejected qty with no rejectedStockBucket → classify as Hold for Checking (QC_HOLD).
-- Does not touch reversed rows or rows already having rejectedStockBucket set.
--
-- Stock ledger:
-- 1) If a single legacy QC stock line posted (accepted+rejected) entirely into USABLE, split off rejected into QC_HOLD.
-- 2) Insert missing QC → QC_HOLD lines so hold bucket matches rejected qty (does not add USABLE).
-- 3) Set QcEntry.rejectedStockBucket = QC_HOLD with a short traceability prefix on reason.

-- ---------------------------------------------------------------------------
-- 1) Split combined USABLE-only QC postings (exactly one QC txn for this ref, qtyIn = accepted + rejected).
-- ---------------------------------------------------------------------------
UPDATE `StockTransaction` st
INNER JOIN `QcEntry` qe
  ON qe.`id` = st.`refId`
  AND st.`transactionType` = 'QC'
  AND st.`stockBucket` = 'USABLE'
  AND qe.`rejectedQty` > 0
  AND qe.`reversedAt` IS NULL
  AND qe.`rejectedStockBucket` IS NULL
INNER JOIN (
  SELECT `refId`
  FROM `StockTransaction`
  WHERE `transactionType` = 'QC'
  GROUP BY `refId`
  HAVING COUNT(*) = 1
) AS `qc_one` ON `qc_one`.`refId` = qe.`id`
SET st.`qtyIn` = qe.`acceptedQty`
WHERE st.`qtyIn` = (qe.`acceptedQty` + qe.`rejectedQty`);

-- ---------------------------------------------------------------------------
-- 2) Post rejected qty into QC_HOLD where missing (one row per legacy QC entry).
-- ---------------------------------------------------------------------------
INSERT INTO `StockTransaction` (`itemId`, `transactionType`, `refId`, `stockBucket`, `qtyIn`, `qtyOut`, `date`, `reason`)
SELECT
  wol.`fgItemId`,
  'QC',
  qe.`id`,
  'QC_HOLD',
  qe.`rejectedQty`,
  0,
  qe.`date`,
  'Legacy migration: rejected qty classified as Hold for Checking (QC_HOLD).'
FROM `QcEntry` qe
INNER JOIN `ProductionEntry` pe ON pe.`id` = qe.`productionId`
INNER JOIN `WorkOrderLine` wol ON wol.`id` = pe.`workOrderLineId`
WHERE qe.`rejectedQty` > 0
  AND qe.`reversedAt` IS NULL
  AND qe.`rejectedStockBucket` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `StockTransaction` st2
    WHERE st2.`refId` = qe.`id`
      AND st2.`transactionType` = 'QC'
      AND st2.`stockBucket` = 'QC_HOLD'
  );

-- ---------------------------------------------------------------------------
-- 3) Persist bucket on QcEntry; keep reason short (VARCHAR limit on legacy column).
-- ---------------------------------------------------------------------------
UPDATE `QcEntry`
SET
  `rejectedStockBucket` = 'QC_HOLD',
  `reason` = CASE
    WHEN `reason` LIKE '[legacy QC_HOLD]%' THEN `reason`
    ELSE LEFT(CONCAT('[legacy QC_HOLD] ', COALESCE(`reason`, '')), 191)
  END
WHERE `rejectedQty` > 0
  AND `reversedAt` IS NULL
  AND `rejectedStockBucket` IS NULL;
