export type GstMode = "exclusive" | "inclusive";

export interface GstLineItem {
  qty: number;
  rate: number;
}

export interface GstTotals {
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
}

export function exGstUnitRate(inclusiveRate: number, gstPercent: number): number {
  if (gstPercent <= 0) return inclusiveRate;
  return inclusiveRate / (1 + gstPercent / 100);
}

export function calculateGstTotals(
  items: GstLineItem[],
  gstPercent: number,
  gstMode: GstMode = "exclusive"
): GstTotals {
  const gross = items.reduce((sum, item) => sum + item.qty * (item.rate || 0), 0);

  if (gstMode === "inclusive") {
    const divisor = 1 + gstPercent / 100;
    const subtotal = divisor > 0 ? gross / divisor : gross;
    const gstAmount = gross - subtotal;
    return { subtotal, gstAmount, grandTotal: gross };
  }

  const subtotal = gross;
  const gstAmount = subtotal * (gstPercent / 100);
  return { subtotal, gstAmount, grandTotal: subtotal + gstAmount };
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
