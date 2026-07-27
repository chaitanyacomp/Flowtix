-- Split vehicle number from LR/transport reference on Sales Bill.
-- Legacy transportationReferenceNo values are preserved as-is (may be combined text).

ALTER TABLE `SalesBill`
  ADD COLUMN `vehicleNumber` VARCHAR(32) NULL;
