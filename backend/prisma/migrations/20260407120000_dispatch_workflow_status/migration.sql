-- Forward dispatch lifecycle: UNLOCKED (draft, no stock yet) -> LOCKED (confirmed, stock out).
-- Existing rows are treated as already confirmed.
ALTER TABLE `Dispatch` ADD COLUMN `workflowStatus` ENUM('UNLOCKED', 'LOCKED') NOT NULL DEFAULT 'LOCKED';
