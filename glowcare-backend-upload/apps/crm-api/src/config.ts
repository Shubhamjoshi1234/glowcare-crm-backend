import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, "../../../.env");
dotenv.config({ path: rootEnv });
dotenv.config();

function serviceBaseUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

export const config = {
  port: Number(process.env.PORT ?? process.env.CRM_API_PORT ?? 4000),
  channelServiceUrl: serviceBaseUrl(
    process.env.CHANNEL_SERVICE_URL ??
      process.env.CHANNEL_SERVICE_HOSTPORT ??
      "http://localhost:5000",
  ),
  channelRequestTimeoutMs: Math.max(
    5000,
    Number(process.env.CHANNEL_REQUEST_TIMEOUT_MS ?? 5000),
  ),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
  aiProvider:
    process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? "openai" : "mock"),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  aiRecipientBatchSize: Math.max(
    1,
    Math.min(25, Number(process.env.AI_RECIPIENT_BATCH_SIZE ?? 10)),
  ),
  aiRecipientConcurrency: Math.max(
    1,
    Math.min(5, Number(process.env.AI_RECIPIENT_CONCURRENCY ?? 2)),
  ),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
