import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env";

// Routers
import authRouter from "./api/routes/auth.routes";
import inboxRouter from "./api/routes/inbox.routes";
import ocrRouter from "./api/routes/ocr.routes";
import enquiryRouter from "./api/routes/enquiry.routes";
import quotationRouter from "./api/routes/quotation.routes";
import inventoryRouter from "./api/routes/inventory.routes";
import customerRouter from "./api/routes/customer.routes";
import automationRouter from "./api/routes/automation.routes";
import userRouter from "./api/routes/user.routes";
import webhookRouter from "./api/routes/webhook.routes";
import fileRouter from "./api/routes/file.routes";
import publicRouter from "./api/routes/public.routes";
import notificationRouter from "./api/routes/notification.routes";
import learningRouter from "./api/routes/learning.routes";
import settingsRouter from "./api/routes/settings.routes";
import quotationTemplateRouter from "./api/routes/quotation-template.routes";
import galleryRouter from "./api/routes/gallery.routes";
import whatsappLogsRouter from "./api/routes/whatsapp-logs.routes";

const app = express();

// CORS Configuration
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);

// Helmet Configuration (disable contentSecurityPolicy in development if needed)
app.use(helmet({
  contentSecurityPolicy: false,
}));

// Body parser with raw body extraction for webhook signature verification
app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// Mount API routes
app.use("/api/auth", authRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api/ocr", ocrRouter);
app.use("/api/enquiries", enquiryRouter);
app.use("/api/quotations", quotationRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/customers", customerRouter);
app.use("/api/automation", automationRouter);
app.use("/api/users", userRouter);
app.use("/api/webhooks", webhookRouter);
app.use("/api/public", publicRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/learning", learningRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/quotation-templates", quotationTemplateRouter);
app.use("/api/galleries", galleryRouter);
app.use("/api/whatsapp-logs", whatsappLogsRouter);
app.use("/api", fileRouter);

app.get("/api/health", (req, res) => {
  res.json({ service: "whatsapp-crm-backend", status: "ok" });
});

export default app;
