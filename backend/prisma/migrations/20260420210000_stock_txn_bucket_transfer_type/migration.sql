-- Add BUCKET_TRANSFER to StockTransaction.transactionType so internal moves don't masquerade as ADJUSTMENT.

ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
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

