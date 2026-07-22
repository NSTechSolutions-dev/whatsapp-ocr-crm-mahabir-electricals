import { displayUnitRate, type GstMode, type GstTotals } from "../utils/gst-calculation";

export interface TallyXmlItem {
  productName: string;
  qty: number;
  unit?: string | null;
  rate?: number | null;
}

export interface TallyXmlInput {
  quotationNumber: string;
  date?: Date;
  customer: {
    name?: string | null;
    phone?: string | null;
    company?: string | null;
  };
  items: TallyXmlItem[];
  gstPercent: number;
  gstMode: GstMode;
  totals: GstTotals;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatTallyDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatAmount(value: number): string {
  return value.toFixed(2);
}

function partyName(customer: TallyXmlInput["customer"]): string {
  const name = customer.name?.trim() || customer.company?.trim() || customer.phone?.trim();
  return name || "Cash";
}

function unitLabel(unit?: string | null): string {
  const u = unit?.trim();
  return u || "nos";
}

/** Build a single TALLYMESSAGE block for one quotation voucher. */
export function buildQuotationTallyMessage(input: TallyXmlInput): string {
  const date = input.date ?? new Date();
  const dateStr = formatTallyDate(date);
  const party = partyName(input.customer);
  const { totals, gstPercent, gstMode } = input;
  const gstLedger = gstPercent > 0 ? `Output GST @ ${gstPercent}%` : "Output GST";
  const salesLedger = "Sales";

  const inventoryBlocks = input.items
    .filter((item) => item.productName?.trim())
    .map((item) => {
      const qty = Number(item.qty) || 0;
      const rate = displayUnitRate(Number(item.rate) || 0, gstPercent, gstMode);
      const amount = qty * rate;
      const unit = unitLabel(item.unit);
      const stockName = item.productName.trim();
      const qtyStr = `${qty} ${unit}`;

      return `      <ALLINVENTORYENTRIES.LIST>
        <STOCKITEMNAME>${escapeXml(stockName)}</STOCKITEMNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <RATE>${formatAmount(rate)}/${escapeXml(unit)}</RATE>
        <AMOUNT>${formatAmount(amount)}</AMOUNT>
        <ACTUALQTY>${escapeXml(qtyStr)}</ACTUALQTY>
        <BILLEDQTY>${escapeXml(qtyStr)}</BILLEDQTY>
        <BATCHALLOCATIONS.LIST>
          <GODOWNNAME>Main Location</GODOWNNAME>
          <BATCHNAME>Primary Batch</BATCHNAME>
          <AMOUNT>${formatAmount(amount)}</AMOUNT>
          <ACTUALQTY>${escapeXml(qtyStr)}</ACTUALQTY>
          <BILLEDQTY>${escapeXml(qtyStr)}</BILLEDQTY>
        </BATCHALLOCATIONS.LIST>
        <ACCOUNTINGALLOCATIONS.LIST>
          <LEDGERNAME>${escapeXml(salesLedger)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>${formatAmount(amount)}</AMOUNT>
        </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>`;
    })
    .join("\n");

  const ledgerParts: string[] = [];

  ledgerParts.push(`      <LEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(party)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        <AMOUNT>-${formatAmount(totals.grandTotal)}</AMOUNT>
      </LEDGERENTRIES.LIST>`);

  if (totals.gstAmount > 0.0001) {
    ledgerParts.push(`      <LEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(gstLedger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${formatAmount(totals.gstAmount)}</AMOUNT>
      </LEDGERENTRIES.LIST>`);
  }

  if (totals.deliveryCharge > 0.0001) {
    ledgerParts.push(`      <LEDGERENTRIES.LIST>
        <LEDGERNAME>Delivery Charges</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${formatAmount(totals.deliveryCharge)}</AMOUNT>
      </LEDGERENTRIES.LIST>`);
  }

  if (Math.abs(totals.roundOff) > 0.0001) {
    ledgerParts.push(`      <LEDGERENTRIES.LIST>
        <LEDGERNAME>Round Off</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${totals.roundOff < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
        <AMOUNT>${formatAmount(totals.roundOff)}</AMOUNT>
      </LEDGERENTRIES.LIST>`);
  }

  const narrationParts = [
    `Quotation ${input.quotationNumber}`,
    input.customer.phone ? `Phone: ${input.customer.phone}` : null,
    input.customer.company ? `Company: ${input.customer.company}` : null,
    `GST mode: ${gstMode}`,
  ].filter(Boolean);

  return `        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Quotation" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${dateStr}</DATE>
            <VCHDATE>${dateStr}</VCHDATE>
            <VOUCHERTYPENAME>Quotation</VOUCHERTYPENAME>
            <VOUCHERNUMBER>${escapeXml(input.quotationNumber)}</VOUCHERNUMBER>
            <REFERENCE>${escapeXml(input.quotationNumber)}</REFERENCE>
            <PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>
            <PARTYNAME>${escapeXml(party)}</PARTYNAME>
            <BASICBUYERNAME>${escapeXml(party)}</BASICBUYERNAME>
            <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
            <ISINVOICE>Yes</ISINVOICE>
            <NARRATION>${escapeXml(narrationParts.join(" | "))}</NARRATION>
${inventoryBlocks}
${ledgerParts.join("\n")}
          </VOUCHER>
        </TALLYMESSAGE>`;
}

/** Wrap one or more TALLYMESSAGE blocks in a Tally Import ENVELOPE. */
export function buildTallyImportEnvelope(messages: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

/**
 * Build a TallyPrime-importable Quotation voucher XML from quotation data.
 */
export function buildQuotationTallyXml(input: TallyXmlInput): string {
  return buildTallyImportEnvelope([buildQuotationTallyMessage(input)]);
}
