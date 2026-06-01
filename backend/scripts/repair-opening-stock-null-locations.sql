-- Backfill locationId on approved opening stock ledger rows (USABLE bucket only).
-- RM / SFG -> LOC-RM-STORE
-- FG -> LOC-FG-STORE
-- CONSUMABLE -> LOC-CONSUMABLE-STORE (fallback: any active CONSUMABLE location)

UPDATE `StockTransaction` st
INNER JOIN `Item` i ON i.`id` = st.`itemId`
SET st.`locationId` = (
  SELECT l.`id`
  FROM `Location` l
  WHERE l.`isActive` = true
    AND (
      (i.`itemType` IN ('RM', 'SFG') AND l.`locationCode` = 'LOC-RM-STORE')
      OR (i.`itemType` = 'FG' AND l.`locationCode` = 'LOC-FG-STORE')
      OR (
        i.`itemType` = 'CONSUMABLE'
        AND l.`locationCode` = 'LOC-CONSUMABLE-STORE'
      )
    )
  LIMIT 1
)
WHERE st.`transactionType` = 'OPENING'
  AND st.`stockBucket` = 'USABLE'
  AND st.`locationId` IS NULL
  AND i.`itemType` IN ('RM', 'SFG', 'FG', 'CONSUMABLE');

UPDATE `StockTransaction` st
INNER JOIN `Item` i ON i.`id` = st.`itemId`
SET st.`locationId` = (
  SELECT l.`id`
  FROM `Location` l
  WHERE l.`isActive` = true
    AND l.`locationType` = 'CONSUMABLE'
  ORDER BY l.`id` ASC
  LIMIT 1
)
WHERE st.`transactionType` = 'OPENING'
  AND st.`stockBucket` = 'USABLE'
  AND st.`locationId` IS NULL
  AND i.`itemType` = 'CONSUMABLE';
