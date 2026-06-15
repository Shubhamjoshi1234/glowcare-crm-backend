import type { Communication } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { aggregateCampaignStats, getCampaignStats } from "../services/analytics.js";
import type { CommunicationStatus } from "../services/lifecycle.js";
import { asyncHandler } from "../utils/async-handler.js";

type CommunicationTrendSource = Pick<
  Communication,
  "sentAt" | "deliveredAt" | "clickedAt" | "convertedAt"
>;
interface CommunicationTrendPoint {
  sent: number;
  delivered: number;
  clicked: number;
  converted: number;
}

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    const [
      totalCustomers,
      totalOrders,
      totalSegments,
      totalCampaigns,
      recentCampaigns,
      communications,
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.order.count(),
      prisma.segment.count(),
      prisma.campaign.count(),
      prisma.campaign.findMany({
        include: { segment: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.communication.findMany({
        select: {
          currentStatus: true,
          sentAt: true,
          deliveredAt: true,
          openedAt: true,
          readAt: true,
          clickedAt: true,
          convertedAt: true,
        },
      }),
    ]);

    response.json({
      totals: { totalCustomers, totalOrders, totalSegments, totalCampaigns },
      overallStats: aggregateCampaignStats(
        communications.length,
        communications as Array<
          (typeof communications)[number] & { currentStatus: CommunicationStatus }
        >,
      ),
      recentCampaigns: await Promise.all(
        recentCampaigns.map(async (campaign) => ({
          ...campaign,
          stats: await getCampaignStats(campaign.id),
        })),
      ),
      dailyTrends: getDailyTrends(communications),
      weeklyTrends: getWeeklyTrends(communications),
    });
  }),
);

function incrementTrend(
  point: CommunicationTrendPoint,
  status: keyof CommunicationTrendPoint,
): void {
  point[status] += 1;
}

function addCommunicationToDailyTrend(
  trends: Record<string, CommunicationTrendPoint & { date: string }>,
  communication: CommunicationTrendSource,
): void {
  const timestamps = [
    ["sent", communication.sentAt],
    ["delivered", communication.deliveredAt],
    ["clicked", communication.clickedAt],
    ["converted", communication.convertedAt],
  ] as const;
  for (const [status, timestamp] of timestamps) {
    if (!timestamp) continue;
    const point = trends[timestamp.toISOString().split("T")[0]!];
    if (point) incrementTrend(point, status);
  }
}

function getDailyTrends(
  communications: CommunicationTrendSource[],
): Array<CommunicationTrendPoint & { date: string }> {
  const trends: Record<string, CommunicationTrendPoint & { date: string }> = {};
  const now = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const dateKey = date.toISOString().split("T")[0]!;
    trends[dateKey] = {
      date: formatDateLabel(date),
      sent: 0,
      delivered: 0,
      clicked: 0,
      converted: 0,
    };
  }
  communications.forEach((communication) =>
    addCommunicationToDailyTrend(trends, communication),
  );
  return Object.values(trends);
}

function getWeeklyTrends(
  communications: CommunicationTrendSource[],
): Array<CommunicationTrendPoint & { week: string }> {
  const trends: Record<string, CommunicationTrendPoint & { week: string }> = {};
  const now = new Date();

  for (let offset = 3; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset * 7);
    const week = getWeekLabel(date);
    trends[week] = { week, sent: 0, delivered: 0, clicked: 0, converted: 0 };
  }

  const timestamps = [
    ["sent", "sentAt"],
    ["delivered", "deliveredAt"],
    ["clicked", "clickedAt"],
    ["converted", "convertedAt"],
  ] as const;
  for (const communication of communications) {
    for (const [status, timestampField] of timestamps) {
      const timestamp = communication[timestampField];
      if (!timestamp) continue;
      const point = trends[getWeekLabel(timestamp)];
      if (point) incrementTrend(point, status);
    }
  }
  return Object.values(trends);
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function getWeekLabel(date: Date): string {
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();
  const dateOffset = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(dateOffset);
  return `Wk of ${startOfWeek.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}
