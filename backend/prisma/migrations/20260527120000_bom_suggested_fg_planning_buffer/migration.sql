-- Suggested default FG planning buffer % on approved BOM (Prepare WO hint only).
ALTER TABLE `Bom` ADD COLUMN `suggestedFgPlanningBufferPercent` DECIMAL(5,2) NULL;
