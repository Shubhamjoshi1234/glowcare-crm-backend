import { CHANNELS } from "@xeno/shared";
import { z } from "zod";

export const channelSchema = z.enum(CHANNELS);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
