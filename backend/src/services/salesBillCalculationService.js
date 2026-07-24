const { Prisma } = require("../prismaClientPackage");

const D = (value = 0) => new Prisma.Decimal(value == null || value === "" ? 0 : value);
const money = (value) => D(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const qty = (value) => D(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

function compatibilityKey(row) {
  return [
    Number(row.itemId),
    String(row.hsnCode || "").trim().toUpperCase(),
    String(row.unit || "").trim(),
    D(row.rate).toFixed(4),
    D(row.discountRate || 0).toFixed(4),
    D(row.gstRate || 0).toFixed(2),
    String(row.taxTreatment || "GOODS").trim().toUpperCase(),
  ].join("|");
}

function aggregateDispatchAllocations(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const allocatedQty = qty(row.allocatedQty);
    if (!allocatedQty.gt(0)) throw Object.assign(new Error("Bill Now quantity must be greater than zero."), { statusCode: 400 });
    const key = compatibilityKey(row);
    const current = groups.get(key) || { ...row, allocatedQty: D(0), sourceAllocations: [] };
    current.allocatedQty = current.allocatedQty.plus(allocatedQty);
    current.sourceAllocations.push({ dispatchId: Number(row.dispatchId), allocatedQty });
    groups.set(key, current);
  }
  return [...groups.values()];
}

function allocateMoneyByWeight(targetAmount, entries) {
  if (!entries.length) return [];
  const targetCents = money(targetAmount).times(100).toDecimalPlaces(0);
  const totalWeight = entries.reduce((sum, entry) => sum.plus(entry.weight), D(0));
  if (!totalWeight.gt(0) || targetCents.eq(0)) return entries.map(() => D(0));
  const shares = entries.map((entry, index) => {
    const exactCents = targetCents.times(entry.weight).div(totalWeight);
    const floorCents = exactCents.toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
    return { index, floorCents, fraction: exactCents.minus(floorCents) };
  });
  let remainder = targetCents.minus(shares.reduce((sum, share) => sum.plus(share.floorCents), D(0))).toNumber();
  const ranked = [...shares].sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
  for (let i = 0; i < remainder; i += 1) ranked[i].floorCents = ranked[i].floorCents.plus(1);
  return shares.sort((a, b) => a.index - b.index).map((share) => share.floorCents.div(100));
}

function allocateTransportation(lines, transportationAmount) {
  const freight = money(transportationAmount);
  if (!freight.gt(0) || !lines.length) return lines.map(() => D(0));
  const total = lines.reduce((sum, line) => sum.plus(line.goodsTaxable), D(0));
  if (!total.gt(0)) throw Object.assign(new Error("Transportation cannot be allocated because goods taxable value is zero."), { statusCode: 409 });
  const largestIndex = lines.reduce((winner, line, index) =>
    line.goodsTaxable.gt(lines[winner].goodsTaxable) ? index : winner, 0);
  const allocations = lines.map((line) => money(freight.times(line.goodsTaxable).div(total)));
  const remainder = freight.minus(allocations.reduce((sum, value) => sum.plus(value), D(0)));
  allocations[largestIndex] = allocations[largestIndex].plus(remainder);
  return allocations;
}

function calculateSalesBillSnapshot({ allocationRows, transportation = {}, intraState }) {
  const grouped = aggregateDispatchAllocations(allocationRows);
  const lines = grouped.map((row) => {
    const gross = D(row.allocatedQty).times(D(row.rate));
    const discount = gross.times(D(row.discountRate || 0)).div(100);
    const goodsTaxable = money(gross.minus(discount));
    return { ...row, qty: qty(row.allocatedQty), goodsTaxable };
  });
  const chargedBy = transportation.chargedBy || "OUR_COMPANY";
  const enteredTransportation = money(transportation.amount || 0);
  if (enteredTransportation.lt(0)) throw Object.assign(new Error("Transportation charges cannot be negative."), { statusCode: 400 });
  const sellerCharged = chargedBy === "OUR_COMPANY";
  const transportationAllocations = sellerCharged ? allocateTransportation(lines, enteredTransportation) : lines.map(() => D(0));

  const calculatedLines = lines.map((line, index) => ({
    ...line,
    basicAmount: line.goodsTaxable.plus(transportationAllocations[index]),
    transportationAllocation: transportationAllocations[index],
    transportationCgstAmount: D(0), transportationSgstAmount: D(0), transportationIgstAmount: D(0),
    cgstAmount: D(0), sgstAmount: D(0), igstAmount: D(0), lineTotal: D(0),
  }));

  const buckets = new Map();
  calculatedLines.forEach((line, lineIndex) => {
    const key = D(line.gstRate || 0).toFixed(2);
    const entries = buckets.get(key) || [];
    entries.push({ lineIndex, kind: "goods", weight: line.goodsTaxable });
    if (line.transportationAllocation.gt(0)) entries.push({ lineIndex, kind: "transportation", weight: line.transportationAllocation });
    buckets.set(key, entries);
  });

  for (const [rateText, entries] of buckets) {
    const taxable = entries.reduce((sum, entry) => sum.plus(entry.weight), D(0));
    let bucketCgst = D(0), bucketSgst = D(0), bucketIgst = D(0);
    if (intraState === true) {
      const halfRate = D(rateText).div(2);
      bucketCgst = money(taxable.times(halfRate).div(100));
      bucketSgst = money(taxable.times(halfRate).div(100));
    } else if (intraState === false) {
      bucketIgst = money(taxable.times(D(rateText)).div(100));
    }
    const cgstShares = allocateMoneyByWeight(bucketCgst, entries);
    const sgstShares = allocateMoneyByWeight(bucketSgst, entries);
    const igstShares = allocateMoneyByWeight(bucketIgst, entries);
    entries.forEach((entry, index) => {
      const line = calculatedLines[entry.lineIndex];
      line.cgstAmount = line.cgstAmount.plus(cgstShares[index]);
      line.sgstAmount = line.sgstAmount.plus(sgstShares[index]);
      line.igstAmount = line.igstAmount.plus(igstShares[index]);
      if (entry.kind === "transportation") {
        line.transportationCgstAmount = cgstShares[index];
        line.transportationSgstAmount = sgstShares[index];
        line.transportationIgstAmount = igstShares[index];
      }
    });
  }

  let totalBasic = D(0), totalCgst = D(0), totalSgst = D(0), totalIgst = D(0);
  calculatedLines.forEach((line) => {
    line.lineTotal = money(line.basicAmount.plus(line.cgstAmount).plus(line.sgstAmount).plus(line.igstAmount));
    totalBasic = totalBasic.plus(line.basicAmount);
    totalCgst = totalCgst.plus(line.cgstAmount);
    totalSgst = totalSgst.plus(line.sgstAmount);
    totalIgst = totalIgst.plus(line.igstAmount);
  });
  const totalTax = totalCgst.plus(totalSgst).plus(totalIgst);
  const unrounded = totalBasic.plus(totalTax);
  const roundedGrand = unrounded.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const roundOffAmount = money(roundedGrand.minus(unrounded));
  return {
    lines: calculatedLines,
    totals: {
      goodsTaxableValue: money(lines.reduce((sum, line) => sum.plus(line.goodsTaxable), D(0))),
      transportationAmount: enteredTransportation,
      transportationTaxableValue: sellerCharged ? enteredTransportation : D(0),
      totalBasic: money(totalBasic), totalCgst: money(totalCgst), totalSgst: money(totalSgst),
      totalIgst: money(totalIgst), totalTax: money(totalTax), roundOffAmount,
      netAmount: money(unrounded.plus(roundOffAmount)),
    },
    transportation: {
      chargedBy,
      allocationMethod: sellerCharged ? "PROPORTIONAL_TAXABLE_VALUE" : "NOT_APPLICABLE",
    },
  };
}

module.exports = { compatibilityKey, aggregateDispatchAllocations, allocateTransportation, allocateMoneyByWeight, calculateSalesBillSnapshot };
