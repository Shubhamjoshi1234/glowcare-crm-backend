import { CALLBACK_STATUSES } from "@xeno/shared";
import { z } from "zod";

export const receiptSchema = z.object({
  event_id: z.string().trim().min(1),
  communication_id: z.string().trim().min(1),
  campaign_id: z.string().trim().min(1),
  provider_message_id: z.string().trim().min(1).optional(),
  status: z.enum(CALLBACK_STATUSES),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
});
