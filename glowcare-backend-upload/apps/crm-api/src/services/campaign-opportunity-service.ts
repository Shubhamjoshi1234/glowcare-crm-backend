import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { normalizeProductCategory } from "./product-categories.js";

export interface ProductPerformance {
  productName: string;
  category: string;
  currentOrders: number;
  previousOrders: number;
  currentRevenue: number;
  averageOrderValue: number;
  currentCustomerIds: Set<string>;
  analysisCustomerIds: Set<string>;
}

export interface OpportunityCandidate {
  id: string;
  anchor: ProductPerformance;
  featuredProducts: [ProductPerformance, ProductPerformance];
  potentialAudience: number;
  reachGap: number;
  score: number;
}

export interface CatalogProductPerformance {
  rank: number;
  productName: string;
  category: string;
  orders: number;
  previousOrders: number;
  revenue: number;
  trendPercent: number | null;
  status: "strong" | "middle" | "focus";
}

export interface CampaignOpportunity {
  id: string;
  headline: string;
  incentiveLabel: string;
  offer: string;
  rationale: string;
  periodDays: number;
  anchor: {
    productName: string;
    category: string;
    orders: number;
    previousOrders: number;
    trendPercent: number | null;
  };
  featuredProducts: Array<{
    productName: string;
    category: string;
    orders: number;
    previousOrders: number;
    trendPercent: number | null;
  }>;
  potentialAudience: number;
  suggestedAudience: {
    name: string;
    description: string;
    rules: { category_purchased: string };
    estimatedSize: number;
  };
  campaignName: string;
  campaignGoal: string;
  messageTemplate: string;
}

interface GeneratedIdea {
  candidateId: string;
  headline: string;
  incentiveLabel: string;
  offer: string;
  rationale: string;
  campaignName: string;
  campaignGoal: string;
  messageTemplate: string;
}

const generatedIdeasSchema = z.object({
  ideas: z.array(
    z.object({
      candidateId: z.string().min(1),
      headline: z.string().trim().min(4).max(90),
      incentiveLabel: z.string().trim().min(3).max(40),
      offer: z.string().trim().min(12).max(220),
      rationale: z.string().trim().min(20).max(320),
      campaignName: z.string().trim().min(4).max(90),
      campaignGoal: z.string().trim().min(12).max(300),
      messageTemplate: z.string().trim().min(40).max(500),
    }),
  ),
});

function stableId(
  anchor: ProductPerformance,
  featuredProducts: [ProductPerformance, ProductPerformance],
): string {
  return createHash("sha256")
    .update(
      `${anchor.productName}:${featuredProducts
        .map((product) => product.productName)
        .join(":")}`,
    )
    .digest("hex")
    .slice(0, 12);
}

function differenceFromBoth(
  audience: Set<string>,
  firstProduct: Set<string>,
  secondProduct: Set<string>,
): number {
  let count = 0;
  for (const customerId of audience) {
    if (!firstProduct.has(customerId) && !secondProduct.has(customerId)) count += 1;
  }
  return count;
}

function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function productSort(left: ProductPerformance, right: ProductPerformance): number {
  return (
    right.currentOrders - left.currentOrders ||
    right.currentRevenue - left.currentRevenue ||
    left.productName.localeCompare(right.productName)
  );
}

function removeSampleLanguage(value: string): string {
  return value
    .replace(/\bsamples\b/gi, "complimentary products")
    .replace(/\bsample\b/gi, "complimentary product")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCatalogPerformance(
  products: ProductPerformance[],
): CatalogProductPerformance[] {
  const sorted = [...products].sort(productSort);
  const focusNames = new Set(sorted.slice(-2).map((product) => product.productName));
  const strongCount = Math.min(3, Math.max(1, sorted.length - 2));

  return sorted.map((product, index) => ({
    rank: index + 1,
    productName: product.productName,
    category: product.category,
    orders: product.currentOrders,
    previousOrders: product.previousOrders,
    revenue: product.currentRevenue,
    trendPercent: trendPercent(product.currentOrders, product.previousOrders),
    status: focusNames.has(product.productName)
      ? "focus"
      : index < strongCount
        ? "strong"
        : "middle",
  }));
}

export function buildOpportunityCandidates(
  products: ProductPerformance[],
): OpportunityCandidate[] {
  if (products.length < 3) return [];

  const sorted = [...products].sort(productSort);
  const featuredProducts = [...sorted.slice(-2).reverse()] as [
    ProductPerformance,
    ProductPerformance,
  ];
  const featuredNames = new Set(
    featuredProducts.map((product) => product.productName),
  );
  const anchors = sorted
    .filter((product) => !featuredNames.has(product.productName))
    .slice(0, 5);

  return anchors
    .map((anchor) => {
      const potentialAudience = differenceFromBoth(
        anchor.analysisCustomerIds,
        featuredProducts[0].analysisCustomerIds,
        featuredProducts[1].analysisCustomerIds,
      );
      const reachGap =
        Math.max(0, anchor.currentOrders - featuredProducts[0].currentOrders) +
        Math.max(0, anchor.currentOrders - featuredProducts[1].currentOrders);
      return {
        id: stableId(anchor, featuredProducts),
        anchor,
        featuredProducts,
        potentialAudience,
        reachGap,
        score:
          potentialAudience * 2 +
          reachGap +
          anchor.currentOrders * 1.5 +
          Math.max(0, anchor.previousOrders - anchor.currentOrders),
      };
    })
    .filter((candidate) => candidate.potentialAudience > 0)
    .sort((left, right) => right.score - left.score);
}

async function loadProductPerformance(periodDays: number): Promise<ProductPerformance[]> {
  const currentEnd = new Date();
  const currentStart = new Date(currentEnd);
  currentStart.setUTCDate(currentStart.getUTCDate() - periodDays);
  const previousStart = new Date(currentStart);
  previousStart.setUTCDate(previousStart.getUTCDate() - periodDays);

  const orders = await prisma.order.findMany({
    where: { orderDate: { gte: previousStart, lte: currentEnd } },
    select: {
      customerId: true,
      productName: true,
      category: true,
      amount: true,
      orderDate: true,
    },
  });

  const products = new Map<string, ProductPerformance>();
  for (const order of orders) {
    const category = normalizeProductCategory(order.category, order.productName);
    const key = `${order.productName.toLowerCase()}:${category}`;
    const performance =
      products.get(key) ??
      ({
        productName: order.productName,
        category,
        currentOrders: 0,
        previousOrders: 0,
        currentRevenue: 0,
        averageOrderValue: 0,
        currentCustomerIds: new Set<string>(),
        analysisCustomerIds: new Set<string>(),
      } satisfies ProductPerformance);

    performance.analysisCustomerIds.add(order.customerId);
    if (order.orderDate >= currentStart) {
      performance.currentOrders += 1;
      performance.currentRevenue += Number(order.amount);
      performance.currentCustomerIds.add(order.customerId);
    } else {
      performance.previousOrders += 1;
    }
    products.set(key, performance);
  }

  return [...products.values()].map((product) => ({
    ...product,
    averageOrderValue:
      product.currentOrders > 0
        ? Math.round(product.currentRevenue / product.currentOrders)
        : 0,
  }));
}

function parseResponseText(body: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string | undefined {
  return (
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text")?.text
  );
}

async function generateIdeasWithOpenAi(
  candidates: OpportunityCandidate[],
  catalog: CatalogProductPerformance[],
): Promise<GeneratedIdea[]> {
  const outputCount = Math.min(3, candidates.length);
  const featuredProducts = candidates[0]?.featuredProducts ?? [];
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
        `Create exactly ${outputCount} materially different D2C campaign ideas for GlowCare.`,
        "Use only the aggregate catalog and audience evidence supplied.",
        "The two lowest-order products are focus products that should appear together in every idea.",
        "Choose a different candidateId for each idea and choose the audience that best fits the idea.",
        "You are free to invent the promotional mechanism. Possible directions include campaign credits, bonus loyalty points, discounts, complimentary gifts, bundle pricing, free delivery, early access, or another sensible mechanic.",
        "Do not repeat the same incentive mechanic across ideas.",
        "Never use the words sample or samples. Use natural customer-facing language such as complimentary gift, discovery duo, bonus product, or featured pair when relevant.",
        "Any percentage, credit, point, or currency amount is an editable AI proposal, not an existing business fact. Keep it commercially conservative because margin and inventory are unavailable.",
        "Do not invent product benefits, stock, margin, customer demographics, or historical loyalty behavior.",
        "The offer must clearly name both focus products.",
        "Write a polished customer message template for each idea. Use {{name}} and optionally {{last_purchase_category}}. Make it 2-3 concise sentences with a warm opening, the proposed incentive, and a clear call to action.",
        "Keep WhatsApp-style copy attractive and substantial, roughly 180-360 characters. Do not mention CRM metrics, segmentation, inactivity, spend, order counts, dates, or database information.",
      ].join(" "),
      input: JSON.stringify({
        focusProducts: featuredProducts.map((product) => ({
          productName: product.productName,
          category: product.category,
          orders: product.currentOrders,
          previousOrders: product.previousOrders,
          revenue: product.currentRevenue,
        })),
        catalog,
        candidateAudiences: candidates.map((candidate) => ({
          candidateId: candidate.id,
          anchorProduct: candidate.anchor.productName,
          anchorCategory: candidate.anchor.category,
          anchorOrders: candidate.anchor.currentOrders,
          previousAnchorOrders: candidate.anchor.previousOrders,
          potentialAudience: candidate.potentialAudience,
          reachGap: candidate.reachGap,
        })),
      }),
      max_output_tokens: 2200,
      text: {
        format: {
          type: "json_schema",
          name: "campaign_ideas",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              ideas: {
                type: "array",
                minItems: outputCount,
                maxItems: outputCount,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    candidateId: {
                      type: "string",
                      enum: candidates.map((candidate) => candidate.id),
                    },
                    headline: { type: "string" },
                    incentiveLabel: { type: "string" },
                    offer: { type: "string" },
                    rationale: { type: "string" },
                    campaignName: { type: "string" },
                    campaignGoal: { type: "string" },
                    messageTemplate: { type: "string" },
                  },
                  required: [
                    "candidateId",
                    "headline",
                    "incentiveLabel",
                    "offer",
                    "rationale",
                    "campaignName",
                    "campaignGoal",
                    "messageTemplate",
                  ],
                },
              },
            },
            required: ["ideas"],
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
  const responseText = parseResponseText(body);
  if (!response.ok || !responseText) {
    throw new Error(body.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
  }

  const parsed = generatedIdeasSchema.parse(JSON.parse(responseText));
  const validIds = new Set(candidates.map((candidate) => candidate.id));
  const seenIds = new Set<string>();
  const seenIncentives = new Set<string>();
  const ideas = parsed.ideas
    .map((idea) => ({
      ...idea,
      headline: removeSampleLanguage(idea.headline),
      incentiveLabel: removeSampleLanguage(idea.incentiveLabel),
      offer: removeSampleLanguage(idea.offer),
      rationale: removeSampleLanguage(idea.rationale),
      campaignName: removeSampleLanguage(idea.campaignName),
      campaignGoal: removeSampleLanguage(idea.campaignGoal),
      messageTemplate: removeSampleLanguage(idea.messageTemplate),
    }))
    .filter((idea) => {
      const incentiveKey = idea.incentiveLabel.toLowerCase();
      if (
        !validIds.has(idea.candidateId) ||
        seenIds.has(idea.candidateId) ||
        seenIncentives.has(incentiveKey)
      ) {
        return false;
      }
      seenIds.add(idea.candidateId);
      seenIncentives.add(incentiveKey);
      return true;
    });

  if (ideas.length !== outputCount) {
    throw new Error("OpenAI returned incomplete or repetitive campaign ideas.");
  }
  return ideas;
}

function fallbackIdeas(candidates: OpportunityCandidate[]): GeneratedIdea[] {
  return candidates.slice(0, 3).map((candidate, index) => {
    const [first, second] = candidate.featuredProducts;
    const pair = `${first.productName} + ${second.productName}`;
    const variants = [
      {
        label: "Complimentary discovery duo",
        offer: `Choose ${candidate.anchor.productName} and receive ${pair} as complimentary additions.`,
        headline: `A discovery duo for ${candidate.anchor.productName} shoppers`,
      },
      {
        label: "Bonus rewards",
        offer: `Earn bonus GlowCare points when you add ${pair} to your next order.`,
        headline: `Reward shoppers for discovering ${pair}`,
      },
      {
        label: "Private bundle offer",
        offer: `Unlock an exclusive bundle price on ${pair} with your next ${candidate.anchor.productName} purchase.`,
        headline: `A private ${pair} bundle for proven shoppers`,
      },
    ] as const;
    const variant = variants[index] ?? variants[0];
    return {
      candidateId: candidate.id,
      headline: variant.headline,
      incentiveLabel: variant.label,
      offer: variant.offer,
      rationale: `${candidate.potentialAudience} ${candidate.anchor.productName} shoppers have not purchased either focus product in the analysis window, creating a clear cross-category opportunity.`,
      campaignName: `${candidate.anchor.category} discovery campaign`,
      campaignGoal: `Introduce ${pair} to existing ${candidate.anchor.category} shoppers through ${variant.label.toLowerCase()}.`,
      messageTemplate: `Hi {{name}}, your {{last_purchase_category}} picks inspired something new for you. ${variant.offer} Explore the pair and find a fresh addition to your GlowCare routine.`,
    };
  });
}

function toOpportunity(
  candidate: OpportunityCandidate,
  periodDays: number,
  idea: GeneratedIdea,
): CampaignOpportunity {
  const { anchor, featuredProducts } = candidate;
  const featuredCategories = featuredProducts.map((product) => product.category);
  return {
    id: candidate.id,
    headline: idea.headline,
    incentiveLabel: idea.incentiveLabel,
    offer: idea.offer,
    rationale: idea.rationale,
    periodDays,
    anchor: {
      productName: anchor.productName,
      category: anchor.category,
      orders: anchor.currentOrders,
      previousOrders: anchor.previousOrders,
      trendPercent: trendPercent(anchor.currentOrders, anchor.previousOrders),
    },
    featuredProducts: featuredProducts.map((product) => ({
      productName: product.productName,
      category: product.category,
      orders: product.currentOrders,
      previousOrders: product.previousOrders,
      trendPercent: trendPercent(product.currentOrders, product.previousOrders),
    })),
    potentialAudience: candidate.potentialAudience,
    suggestedAudience: {
      name: `${anchor.productName} shoppers`,
      description: `Shoppers who previously purchased ${anchor.category}, selected for a campaign featuring ${featuredCategories.join(" and ")}.`,
      rules: { category_purchased: anchor.category },
      estimatedSize: anchor.analysisCustomerIds.size,
    },
    campaignName: idea.campaignName,
    campaignGoal: idea.campaignGoal,
    messageTemplate: idea.messageTemplate,
  };
}

let cached:
  | {
      periodDays: number;
      expiresAt: number;
      value: Awaited<ReturnType<typeof getCampaignOpportunities>>;
    }
  | undefined;

export async function getCampaignOpportunities(
  periodDays: number,
  useCache = true,
): Promise<{
  generatedAt: string;
  periodDays: number;
  provider: "openai" | "fallback";
  productPerformance: CatalogProductPerformance[];
  focusProducts: CatalogProductPerformance[];
  opportunities: CampaignOpportunity[];
  limitations: string[];
}> {
  if (
    useCache &&
    cached?.periodDays === periodDays &&
    cached.expiresAt > Date.now()
  ) {
    return cached.value;
  }

  const products = await loadProductPerformance(periodDays);
  const productPerformance = buildCatalogPerformance(products);
  const focusProducts = productPerformance.filter(
    (product) => product.status === "focus",
  );
  const candidates = buildOpportunityCandidates(products);
  if (candidates.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      periodDays,
      provider: "fallback",
      productPerformance,
      focusProducts,
      opportunities: [],
      limitations: [
        "Not enough product-level order variation exists in this period to recommend campaign ideas.",
      ],
    };
  }

  let provider: "openai" | "fallback" = "fallback";
  let ideas = fallbackIdeas(candidates);
  if (config.aiProvider.toLowerCase() === "openai" && config.openAiApiKey) {
    try {
      ideas = await generateIdeasWithOpenAi(candidates, productPerformance);
      provider = "openai";
    } catch (error) {
      logger.warn({ error }, "OpenAI campaign ideation failed; using evidence fallback");
    }
  }

  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const value = {
    generatedAt: new Date().toISOString(),
    periodDays,
    provider,
    productPerformance,
    focusProducts,
    opportunities: ideas.flatMap((idea) => {
      const candidate = byId.get(idea.candidateId);
      return candidate ? [toOpportunity(candidate, periodDays, idea)] : [];
    }),
    limitations: [
      "AI incentive amounts are editable proposals and must be approved before launch.",
      "Inventory, margin, fulfilment, loyalty-credit redemption, and catalog pricing are not automated by this CRM.",
    ],
  };
  cached = { periodDays, expiresAt: Date.now() + 5 * 60_000, value };
  return value;
}
