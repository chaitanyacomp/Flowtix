-- Extra PO qty above selected Regular SO / PR demand → unrestricted RM stock after GRN.
ALTER TABLE `RmPurchaseOrderLine`
  ADD COLUMN `excessToStockQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;
