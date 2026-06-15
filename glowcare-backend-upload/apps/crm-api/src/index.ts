import { app } from "./app.js";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "CRM API listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down CRM API");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
