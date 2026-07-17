export type GstMode = "exclusive" | "inclusive";

export interface GstLineItem {
  qty: number;
  rate: number;
}

export interface GstTotals {
  subtotal: number;
  deliveryCharge: number;
  gstAmount: number;
  roundOff: number;
  grandTotal: number;
}

export function exGstUnitRate(inclusiveRate: number, gstPercent: number): number {
  if (gstPercent <= 0) return inclusiveRate;
  return inclusiveRate / (1 + gstPercent / 100);
}

export function calculateGstTotals(
  items: GstLineItem[],
  gstPercent: number,
  gstMode: GstMode = "exclusive",
  deliveryCharge: number = 0
): GstTotals {
  const delivery = Number.isFinite(deliveryCharge) && deliveryCharge > 0 ? deliveryCharge : 0;
  const gross = items.reduce((sum, item) => sum + item.qty * (item.rate || 0), 0);

  let subtotal: number;
  let gstAmount: number;
  let rawGrandTotal: number;

  if (gstMode === "inclusive") {
    const divisor = 1 + gstPercent / 100;
    subtotal = divisor > 0 ? gross / divisor : gross;
    gstAmount = gross - subtotal;
    // Pre-GST: delivery is separate and not taxed
    rawGrandTotal = gross + delivery;
  } else {
    subtotal = gross;
    const taxable = subtotal + delivery;
    gstAmount = taxable * (gstPercent / 100);
    // GST: tax applies on items + delivery
    rawGrandTotal = taxable + gstAmount;
  }

  const roundedTotal = Math.round(rawGrandTotal);
  const roundOff = roundedTotal - rawGrandTotal;

  return {
    subtotal,
    deliveryCharge: delivery,
    gstAmount,
    roundOff,
    grandTotal: roundedTotal,
  };
}

export function displayUnitRate(
  rate: number,
  gstPercent: number,
  gstMode: GstMode
): number {
  if (gstMode === "inclusive") {
    return exGstUnitRate(rate, gstPercent);
  }
  return rate;
}

export function displayLineAmount(
  qty: number,
  rate: number,
  gstPercent: number,
  gstMode: GstMode
): number {
  return qty * displayUnitRate(rate, gstPercent, gstMode);
}
