import { prisma } from "../lib/prisma.js";
import { statusRank, type CommunicationStatus } from "./lifecycle.js";

export interface CampaignStats {
  audienceSize: number;
  communicationsCreated: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  read: number;
  clicked: number;
  converted: number;
  deliveryRate: number;
  readRate: number;
  clickRate: number;
  conversionRate: number;
}

export interface AnalyticsCommunication {
  currentStatus: CommunicationStatus;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  openedAt?: Date | null;
  readAt?: Date | null;
  clickedAt?: Date | null;
  convertedAt?: Date | null;
}

function safeRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(1));
}

export function aggregateCampaignStats(
  audienceSize: number,
  communications: AnalyticsCommunication[],
): CampaignStats {
  const statuses = communications.map((communication) => communication.currentStatus);
  const countReached = (
    timestamp: keyof Pick<
      AnalyticsCommunication,
      "sentAt" | "deliveredAt" | "openedAt" | "readAt" | "clickedAt" | "convertedAt"
    >,
    status: Exclude<CommunicationStatus, "failed">,
  ) =>
    communications.filter(
      (communication) =>
        Boolean(communication[timestamp]) ||
        (communication.currentStatus !== "failed" &&
          statusRank[communication.currentStatus] >= statusRank[status]),
    ).length;
  const sent = countReached("sentAt", "sent");
  const delivered = countReached("deliveredAt", "delivered");
  const read = countReached("readAt", "read");
  const clicked = countReached("clickedAt", "clicked");
  const converted = countReached("convertedAt", "converted");

  return {
    audienceSize,
    communicationsCreated: statuses.length,
    queued: statuses.filter((status) => status === "queued").length,
    sent,
    delivered,
    failed: statuses.filter((status) => status === "failed").length,
    opened: countReached("openedAt", "opened"),
    read,
    clicked,
    converted,
    deliveryRate: safeRate(delivered, sent),
    readRate: safeRate(read, delivered),
    clickRate: safeRate(clicked, delivered),
    conversionRate: safeRate(converted, delivered),
  };
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const [audienceSize, communications] = await Promise.all([
    prisma.campaignAudience.count({ where: { campaignId } }),
    prisma.communication.findMany({
      where: { campaignId },
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
  return aggregateCampaignStats(
    audienceSize,
    communications as Array<typeof communications[number] & { currentStatus: CommunicationStatus }>,
  );
}

export async function refreshCampaignStatus(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, sentAt: true },
  });
  if (!campaign || campaign.status === "draft") return;
  if (campaign.sentAt && Date.now() - campaign.sentAt.getTime() < 15_000) return;

  const statuses = await prisma.communication.findMany({
    where: { campaignId },
    select: { currentStatus: true },
  });
  if (statuses.length === 0) return;

  const hasPending = statuses.some(({ currentStatus }) =>
    ["queued", "sent"].includes(currentStatus),
  );
  if (hasPending) return;

  const failedCount = statuses.filter(({ currentStatus }) => currentStatus === "failed").length;
  const nextStatus =
    failedCount === statuses.length
      ? "failed"
      : failedCount > 0
        ? "partially_failed"
        : "completed";
  if (campaign.status !== nextStatus) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: nextStatus },
    });
  }
}
