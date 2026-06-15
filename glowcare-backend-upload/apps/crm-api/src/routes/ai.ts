import { Router } from "express";
import { z } from "zod";
import { channelSchema } from "../schemas/common.js";
import { createMessageDraft } from "../services/ai-service.js";
import { getAudienceInsights } from "../services/audience-insight-service.js";
import { getCampaignOpportunities } from "../services/campaign-opportunity-service.js";
import { asyncHandler } from "../utils/async-handler.js";

const draftSchema = z.object({
  campaignGoal: z.string().trim().min(2).max(500),
  channel: channelSchema,
  tone: z.string().trim().min(2).max(60).default("friendly"),
  offer: z.string().trim().max(240).optional(),
  featuredProducts: z.array(z.string().trim().min(2).max(100)).max(5).optional(),
  segmentSummary: z.object({
    matchedCount: z.number().int().min(0),
    averageSpend: z.number().min(0).optional(),
    topCategories: z
      .array(z.union([z.string(), z.object({ name: z.string(), count: z.number().optional() })]))
      .optional(),
  }),
});

export const aiRouter = Router();

aiRouter.get(
  "/audience-insights",
  asyncHandler(async (request, response) => {
    const periodDays = z.coerce
      .number()
      .int()
      .refine((value) => value === 30 || value === 90, "Period must be 30 or 90 days.")
      .default(90)
      .parse(request.query.periodDays);
    response.json(await getAudienceInsights(periodDays));
  }),
);

aiRouter.get(
  "/campaign-opportunities",
  asyncHandler(async (request, response) => {
    const periodDays = z.coerce
      .number()
      .int()
      .refine((value) => value === 30 || value === 90, "Period must be 30 or 90 days.")
      .default(90)
      .parse(request.query.periodDays);
    response.json(await getCampaignOpportunities(periodDays));
  }),
);

aiRouter.post(
  "/message-draft",
  asyncHandler(async (request, response) => {
    const input = draftSchema.parse(request.body);
    response.json(await createMessageDraft(input));
  }),
);
