-- Additive: PRODUCTION_MANAGER user role for Shift Production lifecycle permissions.
-- Separate from Phase-1 shift session tables (must run after 20260824120000 when deploying).

ALTER TABLE `User`
  MODIFY COLUMN `role` ENUM(
    'ADMIN',
    'STORE',
    'PURCHASE',
    'PRODUCTION',
    'PRODUCTION_MANAGER',
    'QA'
  ) NOT NULL;
