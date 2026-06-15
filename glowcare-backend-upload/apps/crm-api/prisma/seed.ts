import "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import { seedDemoData } from "../src/services/seed-service.js";

try {
  const result = await seedDemoData(process.argv.includes("--reset"));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await prisma.$disconnect();
}
