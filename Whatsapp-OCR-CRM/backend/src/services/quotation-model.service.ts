export interface QuotationLineItem {
  inventoryId: string | null;
  name: string;
  unit: string | null;
  qty: number;
  rate: number;
  total: number;
}

export interface QuotationModel {
  lines: QuotationLineItem[];
  subtotal: number;
  grandTotal: number;
}

export interface QuotationLineInput {
  inventoryId: string | null;
  name: string;
  unit: string | null;
  qty: number;
  rate: number | null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Stage 5: Build quotation totals from matched line items. */
export function buildQuotationModel(lines: QuotationLineInput[]): QuotationModel {
  const quotationLines: QuotationLineItem[] = lines.map((line) => {
    const qty = line.qty > 0 ? line.qty : 1;
    const rate = line.rate ?? 0;
    const total = roundMoney(qty * rate);

    return {
      inventoryId: line.inventoryId,
      name: line.name,
      unit: line.unit,
      qty,
      rate,
      total,
    };
  });

  const subtotal = roundMoney(quotationLines.reduce((sum, line) => sum + line.total, 0));

  return {
    lines: quotationLines,
    subtotal,
    grandTotal: subtotal,
  };
}
