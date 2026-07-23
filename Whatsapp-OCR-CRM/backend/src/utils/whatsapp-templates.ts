const TEMPLATE_BODIES: Record<string, string> = {
  mahabir_inquiry_followup: `Hi {{1}},

We sent your quotation {{2}} a few days ago from Mahabir Electricals.

If you would like to proceed or need any changes, please reply to this message. We are happy to assist you.

Call Us`,

  mahabir_quotation_pdf_delivery: `Thank you for contacting Mahabir Electricals.

Your quotation {{1}} is ready.

If you have any questions or need changes, please reply to this message. We are happy to assist you.

Call Us`,

  mahabir_gallery_catalog: `Hi {{1}},

Please find our {{2}} catalog attached from Mahabir Electricals.

If you have any questions or would like a quotation, reply to this message.

Call Us`,

  image_gallery: `Hi {{1}},

Please find our {{2}} catalog attached from Mahabir Electricals.

If you have any questions or would like a quotation, reply to this message.

Call Us`,

  mahabir_price_drop: `Hi {{1}},

Good news from Mahabir Electricals!

The price of {{2}} has dropped from Rs {{3}} to Rs {{4}}.

Reply with the quantity you need and we will share a fresh quotation.

Call Us`,

  mahabir_repeat_engagement: `Hi {{1}},

This is Mahabir Electricals. We have not heard from you in a while.

If you need wires, switches, fittings, or any electrical supplies, reply with your requirement list and we will prepare a quick quotation for you.

Call Us`,

  mahabir_enquiry_reminder: `Hi {{1}},

This is a reminder from Mahabir Electricals about your quotation {{2}}.

If you would like to proceed or need any changes, please reply to this message. We are happy to assist you.

Call Us`,

  google_review: `Hi {{1}},

Thank you for your order with Mahabir Electricals.

We hope everything met your expectations. Please tap the button below to leave us a Google review — it helps us serve you better.

— Mahabir Electricals`,
};

function normalizeTemplateName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function findTemplateBody(templateName: string): string | null {
  const exact = TEMPLATE_BODIES[templateName];
  if (exact) return exact;

  const normalized = normalizeTemplateName(templateName);
  if (TEMPLATE_BODIES[normalized]) return TEMPLATE_BODIES[normalized];

  for (const [key, body] of Object.entries(TEMPLATE_BODIES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return body;
    }
  }
  return null;
}

export function renderWhatsappTemplate(templateName: string, variables: string[]): string {
  const body = findTemplateBody(templateName);
  if (!body) {
    if (variables.length === 0) return templateName;
    return [templateName, ...variables].join("\n");
  }

  return body.replace(/\{\{(\d+)\}\}/g, (_match, indexStr: string) => {
    const index = Number(indexStr) - 1;
    return variables[index] ?? "";
  });
}

export function buildStoredTemplateContent(
  templateName: string,
  variables: string[],
  _hasDocument: boolean
): string {
  return renderWhatsappTemplate(templateName, variables);
}
