import { randomUUID } from "node:crypto";
import { CHANNELS } from "@xeno/shared";
import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { simulateLifecycle } from "./simulator.js";

const sendSchema = z.object({
  communication_id: z.string().min(1),
  campaign_id: z.string().min(1),
  recipient: z.object({
    name: z.string().min(1),
    phone: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
  }),
  channel: z.enum(CHANNELS),
  message: z.string().min(1),
});

const app = express();
const allowedOrigins = [
  config.frontendUrl,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isLocalhost = origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
      if (isLocalhost || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "channel-service" });
});

app.post("/channel/send", (request, response) => {
  const parsed = sendSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ accepted: false, error: "Invalid send payload.", details: parsed.error.flatten() });
    return;
  }
  if (Math.random() >= 0.95) {
    response.status(503).json({
      accepted: false,
      error: "Simulated provider acceptance failure.",
    });
    return;
  }

  const providerMessageId = `fake_msg_${randomUUID()}`;
  logger.info(
    {
      communicationId: parsed.data.communication_id,
      campaignId: parsed.data.campaign_id,
      providerMessageId,
      channel: parsed.data.channel,
    },
    "Message accepted for simulation",
  );
  response.status(202).json({
    accepted: true,
    provider_message_id: providerMessageId,
  });
  simulateLifecycle(parsed.data, providerMessageId);
});

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found." });
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, callbackUrl: config.callbackUrl }, "Channel service listening");
});

function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down channel service");
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
