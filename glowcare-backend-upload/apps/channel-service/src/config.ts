import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config();

function crmCallbackUrl(): string {
  if (process.env.CRM_CALLBACK_URL) return process.env.CRM_CALLBACK_URL;
  const host = process.env.CRM_SERVICE_HOSTPORT ?? "localhost:4000";
  const baseUrl = /^https?:\/\//i.test(host) ? host : `http://${host}`;
  return `${baseUrl.replace(/\/+$/, "")}/api/receipts/channel-callback`;
}

export const config = {
  port: Number(process.env.PORT ?? process.env.CHANNEL_SERVICE_PORT ?? 5000),
  callbackUrl: crmCallbackUrl(),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  logLevel: process.env.LOG_LEVEL ?? "info",
};
