-- OPENING_REVERSAL: offsets approved OPENING stock (forward row kept; reversalOfId links).
ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
    'OPENING',
    'OPENING_REVERSAL',
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'SCRAP',
    'ADJUSTMENT',
    'BUCKET_TRANSFER',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL',
    'CUSTOMER_RETURN'
  ) NOT NULL;
