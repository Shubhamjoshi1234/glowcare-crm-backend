import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { createSegmentSchema, segmentRulesSchema } from "../schemas/segments.js";
import {
  customerMatchesRules,
  getMatchingCustomers,
  loadCustomerSummaries,
  summarizeSegment,
} from "../services/segment-service.js";
import { normalizeProductCategory } from "../services/product-categories.js";
import { asyncHandler } from "../utils/async-handler.js";
import { HttpError } from "../errors.js";

export const segmentsRouter = Router();

segmentsRouter.get(
  "/options",
  asyncHandler(async (_request, response) => {
    const [cities, categories] = await Promise.all([
      prisma.customer.findMany({
        where: { city: { not: null } },
        distinct: ["city"],
        select: { city: true },
        orderBy: { city: "asc" },
      }),
      prisma.order.findMany({
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    ]);

    response.json({
      cities: cities.flatMap(({ city }) => (city ? [city] : [])),
      categories: [
        ...new Set(categories.map(({ category }) => normalizeProductCategory(category))),
      ].sort(),
      channels: ["whatsapp", "sms", "email", "rcs"],
    });
  }),
);

segmentsRouter.post(
  "/preview",
  asyncHandler(async (request, response) => {
    const rules = segmentRulesSchema.parse(request.body?.rules ?? {});
    const matches = await getMatchingCustomers(rules);
    response.json({
      matchedCount: matches.length,
      sampleCustomers: matches.slice(0, 10),
      summary: summarizeSegment(matches),
    });
  }),
);

segmentsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = createSegmentSchema.parse(request.body);
    const segment = await prisma.segment.create({
      data: {
        name: input.name,
        description: input.description,
        rulesJson: input.rules,
      },
    });
    const matchedCount = (await getMatchingCustomers(input.rules)).length;
    response.status(201).json({ ...segment, matchedCount });
  }),
);

segmentsRouter.get(
  "/",
  asyncHandler(async (_request, response) => {
    const [segments, customers] = await Promise.all([
      prisma.segment.findMany({ orderBy: { createdAt: "desc" } }),
      loadCustomerSummaries(),
    ]);
    response.json({
      data: segments.map((segment) => {
        const rules = segmentRulesSchema.parse(segment.rulesJson);
        return {
          ...segment,
          matchedCount: customers.filter((customer) => customerMatchesRules(customer, rules)).length,
        };
      }),
    });
  }),
);

segmentsRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const segmentId = request.params.id as string;
    const segment = await prisma.segment.findUnique({
      where: { id: segmentId },
      include: {
        campaigns: {
          select: { id: true, name: true, status: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!segment) throw new HttpError(404, "Audience not found.");
    if (segment.campaigns.length > 0) {
      throw new HttpError(
        409,
        `This audience is used by ${segment.campaigns.length} campaign${
          segment.campaigns.length === 1 ? "" : "s"
        }. Delete those campaigns first.`,
        { campaigns: segment.campaigns },
      );
    }

    await prisma.segment.delete({ where: { id: segmentId } });
    response.json({ deleted: true, id: segmentId });
  }),
);

segmentsRouter.get(
  "/:id/customers",
  asyncHandler(async (request, response) => {
    const segment = await prisma.segment.findUnique({
      where: { id: request.params.id as string },
    });
    if (!segment) throw new HttpError(404, "Segment not found.");
    const rules = segmentRulesSchema.parse(segment.rulesJson);
    const customers = await getMatchingCustomers(rules);
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(request.query.limit);
    response.json({
      segment,
      matchedCount: customers.length,
      data: customers.slice(0, limit),
    });
  }),
);
