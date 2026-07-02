import { prisma } from "./src/lib/prisma";
import { scheduleInquiryFollowup } from "./src/services/automation.service";

async function main() {
  console.log("--- Automation verification (inquiry follow-up) ---");

  const customer = await prisma.customer.create({
    data: {
      name: "Test Customer",
      phone: `9198765${String(Date.now()).slice(-4)}`,
      stage: "Lead",
    },
  });

  let rule = await prisma.automationRule.findFirst({
    where: { triggerType: "inquiry_followup" },
  });

  if (!rule) {
    rule = await prisma.automationRule.create({
      data: {
        name: "Inquiry Follow-up",
        triggerType: "inquiry_followup",
        triggerParams: { days: 1 },
        actionType: "send_template",
        actionParams: { templateName: "mahabir_inquiry_followup" },
        isActive: true,
      },
    });
  }

  const enquiry = await prisma.enquiry.create({
    data: {
      customerId: customer.id,
      status: "SENT",
      source: "TEST",
    },
  });

  const quotation = await prisma.quotation.create({
    data: {
      enquiryId: enquiry.id,
      number: `QT-TEST-${Date.now()}`,
      sentAt: new Date(),
    },
  });

  const jobId = await scheduleInquiryFollowup(
    rule.id,
    customer.id,
    1,
    enquiry.id,
    quotation.number
  );

  console.log(`Scheduled inquiry follow-up job: ${jobId}`);
  console.log("OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
