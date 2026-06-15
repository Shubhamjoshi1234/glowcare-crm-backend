import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import type { SegmentRules } from "../schemas/segments.js";
import type { CustomerSummary } from "./customer-summary.js";
import {
  customerMatchesRules,
  loadCustomerSummaries,
  summarizeSegment,
} from "./segment-service.js";

interface PeriodCustomerActivity {
  currentOrders: number;
  previousOrders: number;
  currentRevenue: number;
  previousRevenue: number;
}

export interface AudienceBehaviorMetric {
  id:
    | "high_value"
    | "active_high_value"
    | "at_risk_high_value"
    | "repeat"
    | "one_time"
    | "slipping"
    | "inactive";
  label: string;
  description: string;
  count: number;
  sharePercent: number;
  totalLifetimeValue: number;
  averageSpend: number;
}

export interface AudienceSuggestion {
  id: string;
  title: string;
  rationale: string;
  recommendedName: string;
  description: string;
  rules: SegmentRules;
  matchedCount: number;
  shareOfAudience: number;
  averageSpend: number;
  averageOrderCount: number;
  averageDaysSinceOrder: number | null;
  totalLifetimeValue: number;
  currentPeriodRevenue: number;
  previousPeriodRevenue: number;
  revenueChangePercent: number | null;
  highlights: string[];
}

interface AudienceCandidate extends AudienceSuggestion {
  kind:
    | "high_value_at_risk"
    | "slipping"
    | "active_high_value"
    | "loyal_active"
    | "inactive"
    | "lapsed_loyal"
    | "one_time_inactive";
  score: number;
  matchSignature: string;
}

const rankingSchema = z.object({
  candidateIds: z.array(z.string().min(1)),
});

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : roundMetric((numerator / denominator) * 100);
}

function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return roundMetric(((current - previous) / previous) * 100);
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function roundedSpendThreshold(value: number): number {
  return Math.max(500, Math.round(value / 500) * 500);
}

function suggestionId(periodDays: number, rules: SegmentRules): string {
  return createHash("sha256")
    .update(`${periodDays}:${JSON.stringify(rules)}`)
    .digest("hex")
    .slice(0, 12);
}

function daysSince(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)),
  );
}

function sumLifetimeValue(customers: CustomerSummary[]): number {
  return roundMetric(
    customers.reduce((sum, customer) => sum + customer.totalSpend, 0),
  );
}

function buildBehaviorMetric(
  id: AudienceBehaviorMetric["id"],
  label: string,
  description: string,
  customers: CustomerSummary[],
  totalShoppers: number,
): AudienceBehaviorMetric {
  const totalLifetimeValue = sumLifetimeValue(customers);
  return {
    id,
    label,
    description,
    count: customers.length,
    sharePercent: percentage(customers.length, totalShoppers),
    totalLifetimeValue,
    averageSpend:
      customers.length === 0
        ? 0
        : roundMetric(totalLifetimeValue / customers.length),
  };
}

function makeCandidate(input: {
  periodDays: number;
  kind: AudienceCandidate["kind"];
  title: string;
  rationale: string;
  recommendedName: string;
  description: string;
  rules: SegmentRules;
  customers: CustomerSummary[];
  activityByCustomer: Map<string, PeriodCustomerActivity>;
  highlights: string[];
  now: Date;
  scoreBoost?: number;
}): AudienceCandidate | null {
  const matches = input.customers.filter((customer) =>
    customerMatchesRules(customer, input.rules, input.now),
  );
  if (matches.length === 0) return null;

  const summary = summarizeSegment(matches);
  const currentPeriodRevenue = roundMetric(
    matches.reduce(
      (sum, customer) =>
        sum + (input.activityByCustomer.get(customer.id)?.currentRevenue ?? 0),
      0,
    ),
  );
  const previousPeriodRevenue = roundMetric(
    matches.reduce(
      (sum, customer) =>
        sum + (input.activityByCustomer.get(customer.id)?.previousRevenue ?? 0),
      0,
    ),
  );
  const totalLifetimeValue = sumLifetimeValue(matches);
  const recencyValues = matches.flatMap((customer) => {
    const value = daysSince(customer.lastOrderDate, input.now);
    return value === null ? [] : [value];
  });

  return {
    id: suggestionId(input.periodDays, input.rules),
    kind: input.kind,
    title: input.title,
    rationale: input.rationale,
    recommendedName: input.recommendedName,
    description: input.description,
    rules: input.rules,
    matchedCount: matches.length,
    shareOfAudience: percentage(matches.length, input.customers.length),
    averageSpend: roundMetric(summary.averageSpend),
    averageOrderCount: roundMetric(summary.averageOrderCount),
    averageDaysSinceOrder:
      recencyValues.length === 0
        ? null
        : Math.round(
            recencyValues.reduce((sum, value) => sum + value, 0) /
              recencyValues.length,
          ),
    totalLifetimeValue,
    currentPeriodRevenue,
    previousPeriodRevenue,
    revenueChangePercent: changePercent(
      currentPeriodRevenue,
      previousPeriodRevenue,
    ),
    highlights: input.highlights,
    matchSignature: matches
      .map((customer) => customer.id)
      .sort()
      .join(":"),
    score:
      totalLifetimeValue / 1000 +
      matches.length * 2 +
      summary.averageSpend / 250 +
      (input.scoreBoost ?? 0),
  };
}

export function buildAudienceCandidates(
  customers: CustomerSummary[],
  activityByCustomer: Map<string, PeriodCustomerActivity>,
  periodDays: number,
  now = new Date(),
): AudienceCandidate[] {
  if (customers.length === 0) return [];

  const spendValues = customers.map((customer) => customer.totalSpend);
  const orderValues = customers.map((customer) => customer.orderCount);
  const highSpendThreshold = roundedSpendThreshold(percentile(spendValues, 0.8));
  const middleSpendThreshold = roundedSpendThreshold(percentile(spendValues, 0.5));
  const loyalOrderThreshold = Math.max(
    2,
    Math.round(percentile(orderValues, 0.75)),
  );
  const slippingAfterDays = Math.max(14, Math.round(periodDays / 2));
  const candidates: AudienceCandidate[] = [];

  const definitions: Array<Parameters<typeof makeCandidate>[0]> = [
    {
      periodDays,
      kind: "high_value_at_risk",
      title: "Win back high-value shoppers first",
      rationale: `These shoppers are in the top spending tier but have not ordered in at least ${periodDays} days. Their proven value and current inactivity make them the strongest retention audience.`,
      recommendedName: `High-value shoppers inactive ${periodDays} days`,
      description: `Top-spending shoppers who have not ordered in at least ${periodDays} days.`,
      rules: {
        min_total_spend: highSpendThreshold,
        inactive_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: [
        `INR ${highSpendThreshold.toLocaleString("en-IN")}+ lifetime spend`,
        `${periodDays}+ days inactive`,
        "Proven value now at risk",
      ],
      now,
      scoreBoost: 45,
    },
    {
      periodDays,
      kind: "slipping",
      title: "Catch valuable shoppers before they lapse",
      rationale: `These above-average shoppers bought within the last ${periodDays} days, but not within the most recent ${slippingAfterDays} days. They are losing momentum but are not fully dormant yet.`,
      recommendedName: `Slipping valuable shoppers`,
      description: `Above-average shoppers whose latest order was ${slippingAfterDays}-${periodDays} days ago.`,
      rules: {
        min_total_spend: middleSpendThreshold,
        inactive_days: slippingAfterDays,
        active_within_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: [
        `INR ${middleSpendThreshold.toLocaleString("en-IN")}+ lifetime spend`,
        `Last order ${slippingAfterDays}-${periodDays} days ago`,
        "Early retention window",
      ],
      now,
      scoreBoost: 35,
    },
    {
      periodDays,
      kind: "active_high_value",
      title: "Protect and reward active top shoppers",
      rationale: `These shoppers are in the top spending tier and have purchased within the last ${periodDays} days. They are the clearest loyalty and retention audience.`,
      recommendedName: `Active top-value shoppers`,
      description: `Top-spending shoppers who purchased within the last ${periodDays} days.`,
      rules: {
        min_total_spend: highSpendThreshold,
        active_within_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: [
        `INR ${highSpendThreshold.toLocaleString("en-IN")}+ lifetime spend`,
        `Active in ${periodDays} days`,
        "Highest proven customer value",
      ],
      now,
      scoreBoost: 25,
    },
    {
      periodDays,
      kind: "lapsed_loyal",
      title: "Re-engage formerly loyal shoppers",
      rationale: `These repeat shoppers placed at least ${loyalOrderThreshold} orders historically but have now been inactive for ${periodDays} days or more.`,
      recommendedName: `Lapsed loyal shoppers`,
      description: `Repeat shoppers with ${loyalOrderThreshold} or more orders who are now inactive.`,
      rules: {
        min_order_count: loyalOrderThreshold,
        inactive_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: [
        `${loyalOrderThreshold}+ lifetime orders`,
        `${periodDays}+ days inactive`,
        "Established buying habit",
      ],
      now,
      scoreBoost: 30,
    },
    {
      periodDays,
      kind: "loyal_active",
      title: "Grow active repeat shoppers",
      rationale: `These shoppers have ordered at least ${loyalOrderThreshold} times and remain active within the selected period, making them suitable for loyalty-building campaigns.`,
      recommendedName: `Active repeat shoppers`,
      description: `Repeat shoppers with ${loyalOrderThreshold} or more orders who purchased recently.`,
      rules: {
        min_order_count: loyalOrderThreshold,
        active_within_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: [
        `${loyalOrderThreshold}+ lifetime orders`,
        `Active in ${periodDays} days`,
        "Repeat behavior is established",
      ],
      now,
      scoreBoost: 15,
    },
    {
      periodDays,
      kind: "inactive",
      title: "Run a broad inactive-shopper win-back",
      rationale: `This is the widest retention audience: every shopper who has not ordered in at least ${periodDays} days.`,
      recommendedName: `${periodDays}-day inactive shoppers`,
      description: `All shoppers whose latest order was at least ${periodDays} days ago.`,
      rules: { inactive_days: periodDays },
      customers,
      activityByCustomer,
      highlights: [`${periodDays}+ days inactive`, "Largest win-back reach"],
      now,
    },
    {
      periodDays,
      kind: "one_time_inactive",
      title: "Encourage a second purchase",
      rationale: `These shoppers have made exactly one order and are now inactive. A second-purchase campaign can test whether they can become repeat customers.`,
      recommendedName: `Inactive one-time shoppers`,
      description: `One-time buyers who have not ordered in at least ${periodDays} days.`,
      rules: {
        min_order_count: 1,
        max_order_count: 1,
        inactive_days: periodDays,
      },
      customers,
      activityByCustomer,
      highlights: ["Exactly one lifetime order", `${periodDays}+ days inactive`],
      now,
      scoreBoost: 10,
    },
  ];

  for (const definition of definitions) {
    const candidate = makeCandidate(definition);
    if (candidate) candidates.push(candidate);
  }

  const unique = new Map<string, AudienceCandidate>();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.matchSignature);
    if (!existing || candidate.score > existing.score) {
      unique.set(candidate.matchSignature, candidate);
    }
  }
  return [...unique.values()].sort((left, right) => right.score - left.score);
}

function buildActivityMap(
  orders: Array<{
    customerId: string;
    amount: number;
    orderDate: Date;
  }>,
  currentStart: Date,
): Map<string, PeriodCustomerActivity> {
  const activity = new Map<string, PeriodCustomerActivity>();
  for (const order of orders) {
    const customerActivity =
      activity.get(order.customerId) ??
      ({
        currentOrders: 0,
        previousOrders: 0,
        currentRevenue: 0,
        previousRevenue: 0,
      } satisfies PeriodCustomerActivity);
    if (order.orderDate >= currentStart) {
      customerActivity.currentOrders += 1;
      customerActivity.currentRevenue += Number(order.amount);
    } else {
      customerActivity.previousOrders += 1;
      customerActivity.previousRevenue += Number(order.amount);
    }
    activity.set(order.customerId, customerActivity);
  }
  return activity;
}

async function rankCandidatesWithOpenAi(
  candidates: AudienceCandidate[],
  periodDays: number,
): Promise<string[]> {
  const outputCount = Math.min(3, candidates.length);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openAiModel,
      store: false,
      instructions: [
        "Rank CRM audience cohorts for marketing impact using only the supplied aggregate evidence.",
        "Focus exclusively on audience behavior: recency, frequency, historical spend, recent revenue movement, and value at risk.",
        "Rank the audiences where a campaign is most likely to protect or grow meaningful customer value.",
        "Balance urgency, proven customer value, audience size, and whether intervention is timely.",
        "Prefer different behavioral causes rather than three variations of inactivity.",
        "Return unique candidate IDs only.",
        "Do not discuss products, categories, offers, inventory, margins, or campaign creative.",
        "Do not invent costs, shopper counts, thresholds, customer facts, or business metrics.",
      ].join(" "),
      input: JSON.stringify({
        periodDays,
        candidates: candidates.map((candidate) => ({
          candidateId: candidate.id,
          kind: candidate.kind,
          rules: candidate.rules,
          matchedCount: candidate.matchedCount,
          shareOfAudience: candidate.shareOfAudience,
          averageSpend: candidate.averageSpend,
          averageOrderCount: candidate.averageOrderCount,
          averageDaysSinceOrder: candidate.averageDaysSinceOrder,
          totalLifetimeValue: candidate.totalLifetimeValue,
          currentPeriodRevenue: candidate.currentPeriodRevenue,
          previousPeriodRevenue: candidate.previousPeriodRevenue,
          revenueChangePercent: candidate.revenueChangePercent,
        })),
      }),
      max_output_tokens: 350,
      text: {
        format: {
          type: "json_schema",
          name: "audience_behavior_rankings",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              candidateIds: {
                type: "array",
                minItems: outputCount,
                maxItems: outputCount,
                items: {
                  type: "string",
                  enum: candidates.map((candidate) => candidate.id),
                },
              },
            },
            required: ["candidateIds"],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    error?: { message?: string };
  };
  const responseText =
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text")?.text;
  if (!response.ok || !responseText) {
    throw new Error(body.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
  }

  const parsed = rankingSchema.parse(JSON.parse(responseText));
  const validIds = new Set(candidates.map((candidate) => candidate.id));
  const uniqueIds = [...new Set(parsed.candidateIds)].filter((id) =>
    validIds.has(id),
  );
  if (uniqueIds.length !== outputCount) {
    throw new Error("OpenAI returned incomplete audience rankings.");
  }
  return uniqueIds;
}

type RecommendationCause = "retention_risk" | "slipping" | "active_loyalty";

function recommendationCause(kind: AudienceCandidate["kind"]): RecommendationCause {
  if (kind === "slipping") return "slipping";
  if (kind === "active_high_value" || kind === "loyal_active") {
    return "active_loyalty";
  }
  return "retention_risk";
}

export function selectDiverseCandidates(
  candidates: AudienceCandidate[],
  rankedIds: string[],
  limit = 3,
): AudienceCandidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const ordered = [
    ...rankedIds.flatMap((id) => {
      const candidate = byId.get(id);
      return candidate ? [candidate] : [];
    }),
    ...candidates.filter((candidate) => !rankedIds.includes(candidate.id)),
  ];
  const selected: AudienceCandidate[] = [];
  const usedCauses = new Set<RecommendationCause>();

  for (const candidate of ordered) {
    const cause = recommendationCause(candidate.kind);
    if (usedCauses.has(cause)) continue;
    selected.push(candidate);
    usedCauses.add(cause);
    if (selected.length === limit) return selected;
  }

  for (const candidate of ordered) {
    if (selected.some((selectedCandidate) => selectedCandidate.id === candidate.id)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}

let cached:
  | {
      periodDays: number;
      expiresAt: number;
      value: Awaited<ReturnType<typeof getAudienceInsights>>;
    }
  | undefined;

export async function getAudienceInsights(
  periodDays: number,
  useCache = true,
): Promise<{
  generatedAt: string;
  periodDays: number;
  provider: "openai" | "fallback";
  overview: {
    totalShoppers: number;
    activeShoppers: number;
    inactiveShoppers: number;
    activePercent: number;
    inactivePercent: number;
    currentOrders: number;
    previousOrders: number;
    orderTrendPercent: number | null;
    currentRevenue: number;
    previousRevenue: number;
    revenueTrendPercent: number | null;
  };
  economics: {
    averageOrderValue: number;
    revenuePerActiveShopper: number;
    averageLifetimeValue: number;
    repeatBuyerRate: number;
    oneTimeBuyerRate: number;
    top20RevenueShare: number;
    highValueThreshold: number;
    valueAtRisk: number;
  };
  behaviorMetrics: AudienceBehaviorMetric[];
  suggestions: AudienceSuggestion[];
  costAvailability: {
    customerAcquisitionCost: false;
    productCost: false;
    grossMargin: false;
    campaignCost: false;
    messageCost: false;
    note: string;
  };
  limitations: string[];
}> {
  if (
    useCache &&
    cached?.periodDays === periodDays &&
    cached.expiresAt > Date.now()
  ) {
    return cached.value;
  }

  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setUTCDate(currentStart.getUTCDate() - periodDays);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - periodDays);
  const slippingStart = new Date(now);
  slippingStart.setUTCDate(
    slippingStart.getUTCDate() - Math.max(14, Math.round(periodDays / 2)),
  );

  const [customers, orders] = await Promise.all([
    loadCustomerSummaries(),
    prisma.order.findMany({
      where: { orderDate: { gte: previousStart, lte: now } },
      select: {
        customerId: true,
        amount: true,
        orderDate: true,
      },
    }),
  ]);

  const activityByCustomer = buildActivityMap(orders, currentStart);
  const currentOrders = orders.filter((order) => order.orderDate >= currentStart);
  const previousOrders = orders.filter((order) => order.orderDate < currentStart);
  const activeCustomers = customers.filter(
    (customer) =>
      customer.lastOrderDate !== null && customer.lastOrderDate >= currentStart,
  );
  const inactiveCustomers = customers.filter(
    (customer) =>
      customer.lastOrderDate === null || customer.lastOrderDate < currentStart,
  );
  const highValueThreshold = roundedSpendThreshold(
    percentile(
      customers.map((customer) => customer.totalSpend),
      0.8,
    ),
  );
  const highValueCustomers = customers.filter(
    (customer) => customer.totalSpend >= highValueThreshold,
  );
  const activeHighValueCustomers = highValueCustomers.filter(
    (customer) =>
      customer.lastOrderDate !== null && customer.lastOrderDate >= currentStart,
  );
  const atRiskHighValueCustomers = highValueCustomers.filter(
    (customer) =>
      customer.lastOrderDate === null || customer.lastOrderDate < currentStart,
  );
  const repeatCustomers = customers.filter((customer) => customer.orderCount >= 2);
  const oneTimeCustomers = customers.filter((customer) => customer.orderCount === 1);
  const slippingCustomers = customers.filter(
    (customer) =>
      customer.lastOrderDate !== null &&
      customer.lastOrderDate >= currentStart &&
      customer.lastOrderDate < slippingStart,
  );
  const totalLifetimeValue = sumLifetimeValue(customers);
  const topCustomerCount = Math.max(1, Math.ceil(customers.length * 0.2));
  const topCustomerValue = [...customers]
    .sort((left, right) => right.totalSpend - left.totalSpend)
    .slice(0, topCustomerCount)
    .reduce((sum, customer) => sum + customer.totalSpend, 0);
  const currentRevenue = roundMetric(
    currentOrders.reduce((sum, order) => sum + Number(order.amount), 0),
  );
  const previousRevenue = roundMetric(
    previousOrders.reduce((sum, order) => sum + Number(order.amount), 0),
  );
  const candidates = buildAudienceCandidates(
    customers,
    activityByCustomer,
    periodDays,
    now,
  );

  let provider: "openai" | "fallback" = "fallback";
  let rankedIds = candidates.slice(0, 3).map((candidate) => candidate.id);
  if (
    candidates.length > 0 &&
    config.aiProvider.toLowerCase() === "openai" &&
    config.openAiApiKey
  ) {
    try {
      rankedIds = await rankCandidatesWithOpenAi(candidates, periodDays);
      provider = "openai";
    } catch (error) {
      logger.warn({ error }, "OpenAI audience ranking failed; using evidence score");
    }
  }
  const selectedCandidates = selectDiverseCandidates(candidates, rankedIds);
  const behaviorMetrics = [
    buildBehaviorMetric(
      "at_risk_high_value",
      "High-value at risk",
      `Top spenders inactive for ${periodDays}+ days.`,
      atRiskHighValueCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "slipping",
      "Slipping shoppers",
      `Last purchase was in the earlier half of the ${periodDays}-day window.`,
      slippingCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "active_high_value",
      "Active high-value",
      `Top spenders who purchased within ${periodDays} days.`,
      activeHighValueCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "inactive",
      "Inactive shoppers",
      `No purchase within ${periodDays} days.`,
      inactiveCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "high_value",
      "Top-value shoppers",
      `Shoppers spending at least INR ${highValueThreshold.toLocaleString("en-IN")}.`,
      highValueCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "repeat",
      "Repeat shoppers",
      "Shoppers with at least two lifetime orders.",
      repeatCustomers,
      customers.length,
    ),
    buildBehaviorMetric(
      "one_time",
      "One-time shoppers",
      "Shoppers with exactly one lifetime order.",
      oneTimeCustomers,
      customers.length,
    ),
  ];

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const value = {
    generatedAt: now.toISOString(),
    periodDays,
    provider,
    overview: {
      totalShoppers: customers.length,
      activeShoppers: activeCustomers.length,
      inactiveShoppers: inactiveCustomers.length,
      activePercent: percentage(activeCustomers.length, customers.length),
      inactivePercent: percentage(inactiveCustomers.length, customers.length),
      currentOrders: currentOrders.length,
      previousOrders: previousOrders.length,
      orderTrendPercent: changePercent(currentOrders.length, previousOrders.length),
      currentRevenue,
      previousRevenue,
      revenueTrendPercent: changePercent(currentRevenue, previousRevenue),
    },
    economics: {
      averageOrderValue:
        currentOrders.length === 0
          ? 0
          : roundMetric(currentRevenue / currentOrders.length),
      revenuePerActiveShopper:
        activeCustomers.length === 0
          ? 0
          : roundMetric(currentRevenue / activeCustomers.length),
      averageLifetimeValue:
        customers.length === 0
          ? 0
          : roundMetric(totalLifetimeValue / customers.length),
      repeatBuyerRate: percentage(repeatCustomers.length, customers.length),
      oneTimeBuyerRate: percentage(oneTimeCustomers.length, customers.length),
      top20RevenueShare: percentage(topCustomerValue, totalLifetimeValue),
      highValueThreshold,
      valueAtRisk: sumLifetimeValue(atRiskHighValueCustomers),
    },
    behaviorMetrics,
    suggestions: selectedCandidates.map((candidate) => {
      const {
        kind: _kind,
        score: _score,
        matchSignature: _matchSignature,
        ...suggestion
      } = candidate;
      return suggestion;
    }),
    costAvailability: {
      customerAcquisitionCost: false as const,
      productCost: false as const,
      grossMargin: false as const,
      campaignCost: false as const,
      messageCost: false as const,
      note:
        "The CRM has order revenue but no acquisition, product-cost, margin, campaign-budget, or message-price fields. These costs cannot be calculated honestly yet.",
    },
    limitations: [
      "Audience intelligence uses recency, frequency, order revenue, and lifetime spend from CRM records.",
      "Selections are converted into ordinary editable segment rules and recalculated before saving.",
      "Cost and profitability metrics remain unavailable until the required cost inputs are stored.",
    ],
  };
  cached = { periodDays, expiresAt: Date.now() + 5 * 60_000, value };
  return value;
}
