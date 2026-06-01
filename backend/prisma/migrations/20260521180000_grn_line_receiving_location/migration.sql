-- Phase 2A: GRN receiving location per line + optional default stores for suggestions

ALTER TABLE `GrnLine` ADD COLUMN `locationId` INT NULL;

UPDATE `GrnLine` gl
SET gl.`locationId` = (
  SELECT st.`locationId`
  FROM `StockTransaction` st
  WHERE st.`transactionType` = 'GRN'
    AND st.`refId` = gl.`id`
    AND st.`reversalOfId` IS NULL
  ORDER BY st.`id` ASC
  LIMIT 1
)
WHERE gl.`locationId` IS NULL;

INSERT INTO `Location` (
  `locationCode`,
  `locationName`,
  `locationType`,
  `departmentOwner`,
  `allowRm`,
  `allowFg`,
  `allowSfg`,
  `allowConsumable`,
  `isActive`,
  `isSystem`,
  `updatedAt`
)
SELECT * FROM (
  SELECT
    'LOC-CONSUMABLE-STORE' AS locationCode,
    'Consumable Store' AS locationName,
    'CONSUMABLE' AS locationType,
    'STORES' AS departmentOwner,
    false AS allowRm,
    false AS allowFg,
    false AS allowSfg,
    true AS allowConsumable,
    true AS isActive,
    true AS isSystem,
    NOW(3) AS updatedAt
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Location` l WHERE l.`locationCode` = 'LOC-CONSUMABLE-STORE');

INSERT INTO `Location` (
  `locationCode`,
  `locationName`,
  `locationType`,
  `departmentOwner`,
  `allowRm`,
  `allowFg`,
  `allowSfg`,
  `allowConsumable`,
  `isActive`,
  `isSystem`,
  `updatedAt`
)
SELECT * FROM (
  SELECT
    'LOC-THIRD-PARTY-RM' AS locationCode,
    'Third Party RM Store' AS locationName,
    'VENDOR' AS locationType,
    'PURCHASE' AS departmentOwner,
    true AS allowRm,
    false AS allowFg,
    false AS allowSfg,
    false AS allowConsumable,
    true AS isActive,
    true AS isSystem,
    NOW(3) AS updatedAt
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Location` l WHERE l.`locationCode` = 'LOC-THIRD-PARTY-RM');

ALTER TABLE `GrnLine`
  ADD CONSTRAINT `GrnLine_locationId_fkey`
    FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX `GrnLine_locationId_idx` ON `GrnLine`(`locationId`);
