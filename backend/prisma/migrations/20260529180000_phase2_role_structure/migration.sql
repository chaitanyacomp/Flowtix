-- Phase 2 role structure migration (MySQL)
-- Step 1: expand enum to accept new values while legacy rows still exist
ALTER TABLE `User`
  MODIFY COLUMN `role` ENUM(
    'ADMIN',
    'SALES',
    'STORE',
    'PRODUCTION',
    'QC',
    'SUPERVISOR',
    'ACCOUNTS',
    'PURCHASE',
    'QA'
  ) NOT NULL;

-- Step 2: migrate existing user rows
UPDATE `User` SET `role` = 'ADMIN' WHERE `role` IN ('SALES', 'SUPERVISOR');
UPDATE `User` SET `role` = 'PURCHASE' WHERE `role` = 'ACCOUNTS';
UPDATE `User` SET `role` = 'QA' WHERE `role` = 'QC';

-- Step 3: shrink to approved role set only
ALTER TABLE `User`
  MODIFY COLUMN `role` ENUM('ADMIN', 'STORE', 'PURCHASE', 'PRODUCTION', 'QA') NOT NULL;

-- Step 4: normalize demo login emails (idempotent when target is free)
UPDATE `User` SET `email` = 'qa@test.com', `name` = 'QA'
WHERE `email` = 'qc@test.com' AND `role` = 'QA'
  AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM `User` WHERE email = 'qa@test.com') AS t);

UPDATE `User` SET `email` = 'purchase@test.com', `name` = 'Purchase'
WHERE `email` = 'accounts@test.com' AND `role` = 'PURCHASE'
  AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM `User` WHERE email = 'purchase@test.com') AS t);

UPDATE `User` SET `email` = 'admin-commercial@test.com', `name` = 'Commercial Admin', `role` = 'ADMIN'
WHERE `email` = 'sales@test.com' AND `role` = 'ADMIN'
  AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM `User` WHERE email = 'admin-commercial@test.com') AS t);
