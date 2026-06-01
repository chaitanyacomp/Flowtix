-- Item master: semi-finished and consumable types for BOM components.

ALTER TABLE `Item` MODIFY `itemType` ENUM('RM', 'FG', 'SFG', 'CONSUMABLE') NOT NULL;
