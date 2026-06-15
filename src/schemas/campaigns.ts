import { z } from "zod";
import { channelSchema } from "./common.js";

export const createCampaignSchema = z.object({
  name: z.string().trim().min(2).max(150),
  segmentId: z.string().trim().min(1),
  channel: channelSchema,
  campaignGoal: z.string().trim().max(500).optional().nullable(),
  messageTemplate: z.string().trim().min(1).max(5000),
});
