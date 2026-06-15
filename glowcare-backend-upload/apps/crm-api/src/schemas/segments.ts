import { z } from "zod";
import { channelSchema } from "./common.js";

export const segmentRulesSchema = z
  .object({
    city: z.string().trim().min(1).optional(),
    preferred_channel: channelSchema.optional(),
    min_total_spend: z.coerce.number().min(0).optional(),
    max_total_spend: z.coerce.number().min(0).optional(),
    inactive_days: z.coerce.number().int().min(1).optional(),
    active_within_days: z.coerce.number().int().min(1).optional(),
    category_purchased: z.string().trim().min(1).optional(),
    min_order_count: z.coerce.number().int().min(0).optional(),
    max_order_count: z.coerce.number().int().min(0).optional(),
  })
  .refine(
    (rules) =>
      rules.min_total_spend === undefined ||
      rules.max_total_spend === undefined ||
      rules.min_total_spend <= rules.max_total_spend,
    {
      message: "Minimum total spend cannot exceed maximum total spend.",
      path: ["min_total_spend"],
    },
  )
  .refine(
    (rules) =>
      rules.min_order_count === undefined ||
      rules.max_order_count === undefined ||
      rules.min_order_count <= rules.max_order_count,
    {
      message: "Minimum order count cannot exceed maximum order count.",
      path: ["min_order_count"],
    },
  )
  .refine(
    (rules) =>
      rules.inactive_days === undefined ||
      rules.active_within_days === undefined ||
      rules.inactive_days <= rules.active_within_days,
    {
      message: "Inactive days cannot exceed the active-within window.",
      path: ["inactive_days"],
    },
  );

export type SegmentRules = z.infer<typeof segmentRulesSchema>;

export const createSegmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  rules: segmentRulesSchema,
});
