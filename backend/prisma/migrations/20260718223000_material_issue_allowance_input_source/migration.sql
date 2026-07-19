ALTER TABLE `MaterialIssueLine`
  ADD COLUMN `allowanceInputSource` VARCHAR(16) NULL,
  ADD COLUMN `enteredAllowancePct` DECIMAL(7,4) NULL,
  ADD COLUMN `enteredAllowanceQty` DECIMAL(18,6) NULL;
