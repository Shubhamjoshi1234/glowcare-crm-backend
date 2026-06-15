import { Router } from "express";
import { HttpError } from "../errors.js";
import { prisma } from "../lib/prisma.js";
import { createCampaignSchema } from "../schemas/campaigns.js";
import { segmentRulesSchema } from "../schemas/segments.js";
import { getCampaignStats } from "../services/analytics.js";
import { sendCampaign } from "../services/campaign-service.js";
import { getMatchingCustomers } from "../services/segment-service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const campaignsRouter = Router();

campaignsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = createCampaignSchema.parse(request.body);
    const segment = await prisma.segment.findUnique({ where: { id: input.segmentId } });
    if (!segment) throw new HttpError(404, "Segment not found.");
    const campaign = await prisma.campaign.create({ data: input });
    response.status(201).json(campaign);
  }),
);

campaignsRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    const campaigns = await prisma.campaign.findMany({
      include: { segment: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    response.json({
      data: await Promise.all(
        campaigns.map(async (campaign) => ({
          ...campaign,
          stats: await getCampaignStats(campaign.id),
        })),
      ),
    });
  }),
);

campaignsRouter.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const campaignId = request.params.id as string;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { segment: true },
    });
    if (!campaign) throw new HttpError(404, "Campaign not found.");
    const [stats, communications, receiptEvents, currentAudienceSize] = await Promise.all([
      getCampaignStats(campaign.id),
      prisma.communication.findMany({
        where: { campaignId: campaign.id },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              city: true,
              email: true,
              phone: true,
              preferredChannel: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      prisma.receiptEvent.findMany({
        where: { campaignId: campaign.id },
        orderBy: { receivedAt: "desc" },
        take: 100,
      }),
      campaign.status === "draft"
        ? getMatchingCustomers(segmentRulesSchema.parse(campaign.segment.rulesJson)).then(
            (customers) => customers.length,
          )
        : Promise.resolve(null),
    ]);
    response.json({ campaign, stats, communications, receiptEvents, currentAudienceSize });
  }),
);

campaignsRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const campaignId = request.params.id as string;
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, status: true },
    });
    if (!campaign) throw new HttpError(404, "Campaign not found.");
    if (campaign.status === "sending") {
      throw new HttpError(
        409,
        "This campaign is still sending. Wait for it to complete before deleting it.",
      );
    }
    const pendingCommunications = await prisma.communication.count({
      where: {
        campaignId,
        currentStatus: { in: ["queued", "sent"] },
      },
    });
    if (pendingCommunications > 0) {
      throw new HttpError(
        409,
        "This campaign still has pending communications. Wait for callbacks to settle before deleting it.",
      );
    }

    await prisma.$transaction([
      prisma.receiptEvent.deleteMany({ where: { campaignId } }),
      prisma.campaign.delete({ where: { id: campaignId } }),
    ]);
    response.json({ deleted: true, id: campaignId });
  }),
);

campaignsRouter.post(
  "/:id/send",
  asyncHandler(async (request, response) => {
    const result = await sendCampaign(request.params.id as string);
    response.status(202).json(result);
  }),
);
