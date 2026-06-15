import cors from "cors";
import express from "express";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { logger } from "./lib/logger.js";
import { aiRouter } from "./routes/ai.js";
import { analyticsRouter } from "./routes/analytics.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { customersRouter } from "./routes/customers.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ordersRouter } from "./routes/orders.js";
import { receiptsRouter } from "./routes/receipts.js";
import { seedRouter } from "./routes/seed.js";
import { segmentsRouter } from "./routes/segments.js";

export const app = express();

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
app.use(express.json({ limit: "2mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "crm-api" });
});
app.get("/api/system/health", async (_request, response) => {
  const ai = {
    provider:
      config.aiProvider.toLowerCase() === "openai" && config.openAiApiKey
        ? "openai"
        : "fallback",
    model:
      config.aiProvider.toLowerCase() === "openai" && config.openAiApiKey
        ? config.openAiModel
        : null,
  };
  try {
    const channelResponse = await fetch(`${config.channelServiceUrl}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    response.json({
      crm: { ok: true, service: "crm-api" },
      channel: {
        ok: channelResponse.ok,
        service: "channel-service",
      },
      ai,
    });
  } catch {
    response.json({
      crm: { ok: true, service: "crm-api" },
      channel: { ok: false, service: "channel-service" },
      ai,
    });
  }
});
app.use("/api/dashboard", dashboardRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/seed", seedRouter);
app.use("/api/customers", customersRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/segments", segmentsRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/ai", aiRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found." });
});
app.use(errorHandler);
