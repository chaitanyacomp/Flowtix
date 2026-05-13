-- NO_QTY quotation: snapshot applicable Rate Contract metadata per line.

ALTER TABLE `QuotationLine`
  ADD COLUMN `rateContractLineIdSnapshot` INT NULL,
  ADD COLUMN `rateEffectiveFromSnapshot` DATETIME(3) NULL;

CREATE INDEX `QuotationLine_rateContractLineIdSnapshot_idx` ON `QuotationLine`(`rateContractLineIdSnapshot`);

