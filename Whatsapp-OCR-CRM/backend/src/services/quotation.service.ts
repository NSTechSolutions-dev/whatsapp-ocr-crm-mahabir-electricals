import puppeteer from "puppeteer";
import { prisma } from "../lib/prisma";
import { upload, getPresignedUrl } from "../lib/s3";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export async function generateQuotation(enquiryId: string, gstPercent = 18.0): Promise<any> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    include: {
      customer: true,
      items: true,
    },
  });

  if (!enquiry) {
    throw new Error("Enquiry not found");
  }

  // Calculate totals
  let subtotal = 0;
  for (const item of enquiry.items) {
    const rate = item.rate || 0;
    subtotal += item.qty * rate;
  }

  // GST from finalize request (user-edited on enquiry page)
  const gstAmount = subtotal * (gstPercent / 100);
  const grandTotal = subtotal + gstAmount;

  // Generate Quotation number: QT-YYYY-MM-XXXXX with row lock on Sequence
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const sequenceKey = `quotation-${year}-${month}`;

  let seqNum = 1;
  await prisma.$transaction(async (tx) => {
    // Attempt to select Sequence with row lock
    const existingSeq: any[] = await tx.$queryRaw`
      SELECT * FROM "Sequence" WHERE key = ${sequenceKey} FOR UPDATE
    `;

    if (existingSeq.length > 0) {
      seqNum = existingSeq[0].value + 1;
      await tx.$queryRaw`
        UPDATE "Sequence" SET value = ${seqNum}, "updatedAt" = NOW() WHERE key = ${sequenceKey}
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO "Sequence" (id, key, value, "updatedAt") 
        VALUES (${`seq_${Date.now()}`}, ${sequenceKey}, 1, NOW())
      `;
      seqNum = 1;
    }
  });

  const quotationNumber = `QT-${year}-${month}-${String(seqNum).padStart(5, "0")}`;

  // Build HTML string
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          margin: 0;
          padding: 50px 60px;
          color: #2D3748;
          background-color: #ffffff;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 25px;
        }
        .logo-section {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .logo-title {
          font-size: 14px;
          font-weight: 800;
          color: #7F1D1D;
          letter-spacing: 0.5px;
          line-height: 1.3;
          margin-top: 8px;
        }
        .company-contact {
          text-align: right;
          color: #7F1D1D;
          font-size: 11px;
          font-weight: 500;
          line-height: 1.5;
        }
        .title {
          text-align: center;
          font-size: 32px;
          font-weight: 800;
          color: #7F1D1D;
          margin: 30px 0;
          letter-spacing: 3px;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 40px;
          margin-bottom: 25px;
          font-size: 13px;
          line-height: 1.6;
        }
        .info-col p {
          margin: 4px 0;
        }
        .info-label {
          font-weight: bold;
          display: inline-block;
          width: 110px;
        }
        .info-col-right {
          text-align: left;
        }
        .customer-title {
          font-weight: 800;
          font-size: 14px;
          margin-bottom: 4px;
        }
        .divider {
          height: 3px;
          background-color: #7F1D1D;
          margin: 15px 0 25px 0;
        }
        .project-desc-section {
          margin-bottom: 30px;
          font-size: 13px;
          line-height: 1.5;
        }
        .project-desc-title {
          font-weight: bold;
          text-transform: uppercase;
          color: #1a202c;
          display: inline-block;
          width: 160px;
          vertical-align: top;
        }
        .project-desc-text {
          display: inline-block;
          width: calc(100% - 170px);
          color: #4a5568;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th {
          background-color: #7F1D1D;
          color: #ffffff;
          padding: 10px 14px;
          text-align: left;
          font-size: 13px;
          font-weight: bold;
          border-right: 2px solid #ffffff;
        }
        th:last-child {
          border-right: none;
        }
        td {
          padding: 12px 14px;
          font-size: 13px;
          color: #4a5568;
          background-color: #f7fafc;
          border-bottom: 2px solid #ffffff;
        }
        .totals-container {
          display: flex;
          justify-content: flex-end;
          margin-top: 15px;
        }
        .totals-table {
          width: 320px;
          font-size: 13px;
        }
        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 8px;
          color: #4a5568;
        }
        .totals-row.bold {
          font-weight: bold;
          color: #1a202c;
        }
        .totals-row.grand-total {
          background-color: #7F1D1D;
          color: #ffffff;
          padding: 10px 12px;
          font-weight: bold;
          font-size: 14px;
          margin-top: 8px;
        }
        .terms-section {
          margin-top: 40px;
          font-size: 12px;
          line-height: 1.6;
          border-top: 2px solid #7F1D1D;
          padding-top: 15px;
        }
        .terms-title {
          font-weight: bold;
          color: #1a202c;
          margin-bottom: 6px;
        }
        .terms-text {
          color: #718096;
        }
        .acceptance-title {
          text-align: center;
          font-weight: bold;
          font-size: 13px;
          color: #1a202c;
          margin: 40px 0 30px 0;
          letter-spacing: 0.5px;
        }
        .signatures {
          display: flex;
          justify-content: space-between;
          margin-top: 40px;
          padding: 0 40px;
        }
        .sig-col {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .sig-line {
          border-top: 1px solid #718096;
          width: 200px;
          margin-bottom: 6px;
        }
        .sig-label {
          font-size: 11px;
          color: #718096;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-section">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="#7F1D1D" aria-hidden="true">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <div class="logo-title">${env.COMPANY_NAME.toUpperCase()}<br/>ELECTRICAL SUPPLIES</div>
        </div>
        <div class="company-contact">
          <div>${env.COMPANY_ADDRESS.toUpperCase()}</div>
          <div>PHONE: ${env.COMPANY_PHONE}</div>
          <div>GSTIN: ${env.COMPANY_GSTIN}</div>
        </div>
      </div>

      <div class="title">QUOTATION</div>

      <div class="info-grid">
        <div class="info-col">
          <p><span class="info-label">Quotation No:</span> #${quotationNumber}</p>
          <p><span class="info-label">Date:</span> ${now.toLocaleDateString('en-US', {month: '2-digit', day: '2-digit', year: 'numeric'})}</p>
          <p><span class="info-label">Valid Until:</span> ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit', year: 'numeric'})}</p>
          <p><span class="info-label">Customer ID:</span> ${enquiry.customer.id.substring(0, 8).toUpperCase()}</p>
        </div>
        <div class="info-col info-col-right">
          <div class="customer-title">${(enquiry.customer.name || "Customer").toUpperCase()}</div>
          <div>${enquiry.customer.company || "—"}</div>
          <div>${enquiry.customer.phone}</div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="project-desc-section">
        <div class="project-desc-title">Project Description</div>
        <div class="project-desc-text">Add a brief and concise description of the project, item, or service here.</div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 50%;">Description</th>
            <th style="text-align: center; width: 15%;">Quantity</th>
            <th style="text-align: right; width: 15%;">Price</th>
            <th style="text-align: right; width: 20%;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${enquiry.items.map((item) => `
            <tr>
              <td>${item.productName}</td>
              <td style="text-align: center;">${item.qty} ${item.unit || "pcs"}</td>
              <td style="text-align: right;">₹${(item.rate || 0).toFixed(2)}</td>
              <td style="text-align: right;">₹${((item.qty * (item.rate || 0))).toFixed(2)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="totals-container">
        <div class="totals-table">
          <div class="totals-row">
            <span>Subtotal</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          <div class="totals-row">
            <span>Value-Added Tax (${gstPercent}%)</span>
            <span>₹${gstAmount.toFixed(2)}</span>
          </div>
          <div class="totals-row">
            <span>Others</span>
            <span>₹0.00</span>
          </div>
          <div class="totals-row grand-total">
            <span>Total</span>
            <span>₹${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div class="terms-section">
        <div class="terms-title">TERMS & CONDITIONS</div>
        <div class="terms-text">Above information is not an invoice and only an estimate of goods/services. Payment will be due prior to provision or delivery of goods/services.</div>
      </div>

      <div class="acceptance-title">PLEASE CONFIRM YOUR ACCEPTANCE OF THIS QUOTE</div>

      <div class="signatures">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-label">Signature over printed name</div>
        </div>
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-label">Date signed</div>
        </div>
      </div>
    </body>
    </html>
  `;

  // Render using Puppeteer
  let browser;
  try {
    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    };
    const executablePath =
      env.PUPPETEER_EXECUTABLE_PATH?.trim() || process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
    if (executablePath) {
      launchOptions.executablePath = executablePath;
      logger.info(`Using Puppeteer executable: ${executablePath}`);
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(30_000);
    page.setDefaultTimeout(60_000);
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, { waitUntil: "load", timeout: 30_000 });
    const buffer = await page.pdf({ format: "A4", printBackground: true, timeout: 60_000 });

    const key = `quotations/${year}/${month}/${enquiryId}.pdf`;
    await upload(key, buffer, "application/pdf");

    const presignedUrl = await getPresignedUrl(key);

    // Upsert or create Quotation record
    const quotation = await prisma.quotation.upsert({
      where: { enquiryId },
      update: {
        s3Key: key,
        s3Url: presignedUrl,
        number: quotationNumber,
      },
      create: {
        enquiryId,
        s3Key: key,
        s3Url: presignedUrl,
        number: quotationNumber,
      },
    });

    return quotation;
  } catch (error) {
    logger.error("Puppeteer rendering failed, falling back to mock HTML file: " + error);
    const key = `quotations/${year}/${month}/${enquiryId}.html`;
    await upload(key, Buffer.from(htmlContent), "text/html");
    
    const presignedUrl = await getPresignedUrl(key);

    const quotation = await prisma.quotation.upsert({
      where: { enquiryId },
      update: {
        s3Key: key,
        s3Url: presignedUrl,
        number: quotationNumber,
      },
      create: {
        enquiryId,
        s3Key: key,
        s3Url: presignedUrl,
        number: quotationNumber,
      },
    });
    return quotation;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
