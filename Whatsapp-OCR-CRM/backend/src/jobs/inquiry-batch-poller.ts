import { enqueueExpiredWaitingEnquiries } from "../services/inquiry-grouping.service";
import { logger } from "../utils/logger";

const POLL_INTERVAL_MS = 15_000;

let pollerTimer: ReturnType<typeof setInterval> | null = null;

export function startInquiryBatchPoller(): void {
  if (pollerTimer) return;

  pollerTimer = setInterval(async () => {
    try {
      const enqueued = await enqueueExpiredWaitingEnquiries();
      if (enqueued > 0) {
        logger.info(`Inquiry batch poller enqueued ${enqueued} expired WAITING enquiry(s)`);
      }
    } catch (error) {
      logger.error(`Inquiry batch poller error: ${error}`);
    }
  }, POLL_INTERVAL_MS);

  logger.info(`Inquiry batch poller started (every ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopInquiryBatchPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}
