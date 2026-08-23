-- Additive: Standard Purging Qty per Setup (grams) on BOM header.
-- Existing rows receive DEFAULT 0.

ALTER TABLE `Bom`
ADD COLUMN `standardPurgingQtyGrams` DECIMAL(18, 4) NOT NULL DEFAULT 0;
