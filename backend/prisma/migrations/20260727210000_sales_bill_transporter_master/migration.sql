-- Sales Bill transporter master link + Supplier transporter classification.
-- Preserves legacy transporterName text; transporterId is optional for historical rows.

ALTER TABLE `Supplier`
  ADD COLUMN `isTransporter` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `Supplier_isTransporter_idx` ON `Supplier`(`isTransporter`);

ALTER TABLE `SalesBill`
  ADD COLUMN `transporterId` INTEGER NULL;

CREATE INDEX `SalesBill_transporterId_idx` ON `SalesBill`(`transporterId`);

ALTER TABLE `SalesBill`
  ADD CONSTRAINT `SalesBill_transporterId_fkey`
    FOREIGN KEY (`transporterId`) REFERENCES `Supplier`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
