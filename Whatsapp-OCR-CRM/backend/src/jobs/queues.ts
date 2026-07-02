import { Queue } from "bullmq";
import { redisConnection } from "../lib/redis";

const queueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

export const ocrQueue = new Queue("ocrQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const quotationQueue = new Queue("quotationQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 2000,
    },
  },
});

export const whatsappQueue = new Queue("whatsappQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "fixed",
      delay: 2000,
    },
  },
});

export const automationQueue = new Queue("automationQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 1,
    backoff: {
      type: "fixed",
      delay: 1000,
    },
  },
});

export const inboundQueue = new Queue("inboundQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
  },
});

export const inventoryScoreQueue = new Queue("inventoryScoreQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: true,
    removeOnFail: false,
  },
});

export const embedProductQueue = new Queue("embedProductQueue", {
  ...queueOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
  },
});
