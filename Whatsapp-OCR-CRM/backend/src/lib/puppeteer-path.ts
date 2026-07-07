import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { env } from "../config/env";
import { logger } from "../utils/logger";

function findPlaywrightChrome(): string | undefined {
  const base = path.join(process.env.HOME || "", ".cache/ms-playwright");
  if (!fs.existsSync(base)) return undefined;

  const dirs = fs
    .readdirSync(base)
    .filter((name) => name.startsWith("chromium"))
    .sort()
    .reverse();

  for (const dir of dirs) {
    const chrome = path.join(base, dir, "chrome-linux", "chrome");
    if (fs.existsSync(chrome)) return chrome;
  }
  return undefined;
}

function findPuppeteerCacheChrome(): string | undefined {
  const base = path.join(process.env.HOME || "", ".cache/puppeteer/chrome");
  if (!fs.existsSync(base)) return undefined;

  const dirs = fs.readdirSync(base).sort().reverse();
  for (const dir of dirs) {
    const candidates = [
      path.join(base, dir, "chrome-linux", "chrome"),
      path.join(base, dir, "chrome-linux64", "chrome"),
    ];
    for (const chrome of candidates) {
      if (fs.existsSync(chrome)) return chrome;
    }
  }
  return undefined;
}

export function resolvePuppeteerExecutable(): string | undefined {
  const fromEnv =
    env.PUPPETEER_EXECUTABLE_PATH?.trim() || process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  const candidates = [
    fromEnv,
    findPlaywrightChrome(),
    findPuppeteerCacheChrome(),
    (() => {
      try {
        return puppeteer.executablePath();
      } catch {
        return undefined;
      }
    })(),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  logger.warn(
    `No Puppeteer Chrome binary found. Set PUPPETEER_EXECUTABLE_PATH (tried: ${candidates.join(", ") || "none"})`
  );
  return undefined;
}
