import type { Prisma } from "@prisma/client";
import type { Channel } from "@xeno/shared";
import { prisma } from "../lib/prisma.js";

const firstNames = [
  "Aarav",
  "Aditi",
  "Ananya",
  "Arjun",
  "Diya",
  "Ishaan",
  "Kabir",
  "Kavya",
  "Meera",
  "Neha",
  "Riya",
  "Rohan",
  "Saanvi",
  "Vihaan",
  "Zoya",
];
const lastNames = [
  "Agarwal",
  "Bose",
  "Gupta",
  "Iyer",
  "Jain",
  "Kapoor",
  "Khan",
  "Mehta",
  "Nair",
  "Patel",
  "Reddy",
  "Shah",
  "Sharma",
  "Singh",
  "Verma",
];
const cities = ["Delhi", "Mumbai", "Bengaluru", "Hyderabad", "Pune", "Chennai", "Kolkata", "Jaipur"];
const channels: Channel[] = ["whatsapp", "sms", "email", "rcs"];
const products = [
  { productName: "Vitamin C Glow Serum", category: "serum", baseAmount: 1299 },
  { productName: "Hydra Repair Moisturizer", category: "moisturizer", baseAmount: 899 },
  { productName: "Daily Shield SPF 50", category: "sunscreen", baseAmount: 749 },
  { productName: "Gentle Cloud Cleanser", category: "face wash", baseAmount: 599 },
  { productName: "Rose Quartz Lip Tint", category: "makeup", baseAmount: 649 },
  { productName: "Night Renewal Cream", category: "night cream", baseAmount: 1499 },
  { productName: "Caffeine Eye Gel", category: "eye cream", baseAmount: 999 },
  { productName: "Barrier Support Toner", category: "toner", baseAmount: 799 },
];

function seededNumber(seed: number): number {
  const value = Math.sin(seed * 999.91) * 43758.5453;
  return value - Math.floor(value);
}

function pick<T>(items: T[], seed: number): T {
  return items[Math.floor(seededNumber(seed) * items.length)]!;
}

export async function seedDemoData(reset = false) {
  const existingCustomers = await prisma.customer.count();
  if (existingCustomers > 0 && !reset) {
    return {
      seeded: false,
      message: "Demo data already exists. Use ?reset=true to replace it.",
      customers: existingCustomers,
      orders: await prisma.order.count(),
    };
  }

  if (reset) {
    await prisma.$transaction([
      prisma.receiptEvent.deleteMany(),
      prisma.communication.deleteMany(),
      prisma.campaignAudience.deleteMany(),
      prisma.campaign.deleteMany(),
      prisma.segment.deleteMany(),
      prisma.order.deleteMany(),
      prisma.customer.deleteMany(),
    ]);
  }

  const now = new Date();
  const customers: Prisma.CustomerCreateInput[] = Array.from({ length: 500 }, (_, index) => {
    const firstName = pick(firstNames, index + 1);
    const lastName = pick(lastNames, index + 81);
    return {
      name: `${firstName} ${lastName}`,
      email: `${firstName}.${lastName}.${index + 1}@example.com`.toLowerCase(),
      phone: `9${String(100000000 + index).padStart(9, "0")}`,
      city: pick(cities, index + 151),
      age: 20 + Math.floor(seededNumber(index + 211) * 36),
      gender: index % 3 === 0 ? "male" : index % 3 === 1 ? "female" : "non-binary",
      preferredChannel: pick(channels, index + 301),
    };
  });

  for (let customerIndex = 0; customerIndex < customers.length; customerIndex += 1) {
    const customer = customers[customerIndex]!;
    const created = await prisma.customer.create({ data: customer });
    const orders = Array.from({ length: 3 }, (_, orderIndex) => {
      const seed = customerIndex * 7 + orderIndex + 1;
      const product = pick(products, seed);
      const daysAgo = Math.floor(seededNumber(seed + 501) * 365);
      const orderDate = new Date(now);
      orderDate.setUTCDate(orderDate.getUTCDate() - daysAgo);
      const quantityFactor = 1 + Math.floor(seededNumber(seed + 801) * 3);
      const variation = Math.round(seededNumber(seed + 901) * 250);
      return {
        customerId: created.id,
        productName: product.productName,
        category: product.category,
        amount: product.baseAmount * quantityFactor + variation,
        orderDate,
      };
    });
    await prisma.order.createMany({ data: orders });
  }

  // Seed a couple of mock segments, campaigns, and communications
  const segment1 = await prisma.segment.create({
    data: {
      name: "Gentle wash fans",
      description: "Shoppers who bought Gentle Cloud Cleanser",
      rulesJson: { category_purchased: "face wash" },
    },
  });

  const segment2 = await prisma.segment.create({
    data: {
      name: "Serum discoverers",
      description: "Shoppers who bought Vitamin C Glow Serum",
      rulesJson: { category_purchased: "serum" },
    },
  });

  const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true, preferredChannel: true, email: true, phone: true } });
  
  // Historical campaign 1 (8 days ago)
  const d8 = new Date(now);
  d8.setDate(d8.getDate() - 8);
  const campaign1 = await prisma.campaign.create({
    data: {
      name: "Cleanser Cleanse Promo",
      segmentId: segment1.id,
      channel: "email",
      campaignGoal: "Promote new gentle cleanser formula",
      messageTemplate: "Hi {{name}}, try our new cleanser!",
      status: "completed",
      createdAt: d8,
      sentAt: d8,
    },
  });

  // Historical campaign 2 (3 days ago)
  const d3 = new Date(now);
  d3.setDate(d3.getDate() - 3);
  const campaign2 = await prisma.campaign.create({
    data: {
      name: "Serum Glow Winback",
      segmentId: segment2.id,
      channel: "whatsapp",
      campaignGoal: "Win back serum shoppers",
      messageTemplate: "Hi {{name}}, we have an exclusive serum deal!",
      status: "completed",
      createdAt: d3,
      sentAt: d3,
    },
  });

  // Seed communications for Campaign 1
  const comms1Data = allCustomers.slice(0, 120).map((c, idx) => {
    const isFailed = idx % 10 === 0;
    const isDelivered = !isFailed;
    const isRead = isDelivered && idx % 3 !== 0;
    const isClicked = isRead && idx % 5 === 0;
    const isConverted = isClicked && idx % 10 === 0;

    const sentAt = new Date(d8);
    const deliveredAt = isDelivered ? new Date(d8) : null;
    const readAt = isRead ? new Date(d8) : null;
    const clickedAt = isClicked ? new Date(d8) : null;
    const convertedAt = isConverted ? new Date(now) : null;
    if (convertedAt) {
      convertedAt.setDate(convertedAt.getDate() - 7);
    }

    return {
      campaignId: campaign1.id,
      customerId: c.id,
      channel: "email" as const,
      recipientJson: { name: c.name, email: c.email },
      personalizedMessage: `Hi ${c.name.split(" ")[0]}, try our new cleanser!`,
      currentStatus: isConverted ? "converted" : isClicked ? "clicked" : isRead ? "read" : isDelivered ? "delivered" : "failed",
      sentAt,
      deliveredAt,
      failedAt: isFailed ? new Date(d8) : null,
      openedAt: isRead ? new Date(d8) : null,
      readAt,
      clickedAt,
      convertedAt,
    };
  });

  // Seed communications for Campaign 2
  const comms2Data = allCustomers.slice(120, 200).map((c, idx) => {
    const isFailed = idx % 12 === 0;
    const isDelivered = !isFailed;
    const isRead = isDelivered && idx % 2 === 0;
    const isClicked = isRead && idx % 4 === 0;
    const isConverted = isClicked && idx % 8 === 0;

    const sentAt = new Date(d3);
    const deliveredAt = isDelivered ? new Date(d3) : null;
    const readAt = isRead ? new Date(d3) : null;
    const clickedAt = isClicked ? new Date(d3) : null;
    const convertedAt = isConverted ? new Date(now) : null;
    if (convertedAt) {
      convertedAt.setDate(convertedAt.getDate() - 2);
    }

    return {
      campaignId: campaign2.id,
      customerId: c.id,
      channel: "whatsapp" as const,
      recipientJson: { name: c.name, phone: c.phone },
      personalizedMessage: `Hi ${c.name.split(" ")[0]}, we have an exclusive serum deal!`,
      currentStatus: isConverted ? "converted" : isClicked ? "clicked" : isRead ? "read" : isDelivered ? "delivered" : "failed",
      sentAt,
      deliveredAt,
      failedAt: isFailed ? new Date(d3) : null,
      openedAt: isRead ? new Date(d3) : null,
      readAt,
      clickedAt,
      convertedAt,
    };
  });

  const audiencesData = [
    ...comms1Data.map(c => ({ campaignId: c.campaignId, customerId: c.customerId, snapshotJson: {} })),
    ...comms2Data.map(c => ({ campaignId: c.campaignId, customerId: c.customerId, snapshotJson: {} }))
  ];

  await prisma.campaignAudience.createMany({ data: audiencesData });
  await prisma.communication.createMany({ data: comms1Data });
  await prisma.communication.createMany({ data: comms2Data });

  return {
    seeded: true,
    message: "GlowCare demo data created.",
    customers: 500,
    orders: 1500,
    campaigns: 2,
    communications: 200,
  };
}
