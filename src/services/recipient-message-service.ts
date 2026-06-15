import { createHash } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { CustomerSummary } from "./customer-summary.js";

export interface RecipientMessageCampaign {
  name: string;
  goal: string | null;
  channel: string;
  creativeBrief: string;
}

export interface GeneratedRecipientMessage {
  customerId: string;
  message: string;
  reason: string;
  source: "openai" | "fallback";
}

const frameIds = [
  "product-inspired",
  "after-product",
  "product-note",
  "purchase-inspired",
  "category-return",
  "next-category",
  "simple-product",
  "category-find",
  "explore-category",
  "latest-pick",
] as const;

const invitationIds = [
  "discover-next",
  "take-another-look",
  "find-next",
  "browse-glowcare",
  "next-favorite",
  "return-when-ready",
] as const;

type FrameId = (typeof frameIds)[number];
type InvitationId = (typeof invitationIds)[number];

const generatedBatchSchema = z.object({
  messages: z.array(
    z.object({
      customerId: z.string().min(1),
      message: z.string().trim().min(30).max(700),
    }),
  ),
});

const unsupportedClaimPattern =
  /\b(latest arrivals?|new options?|what(?:'|\u2019)s new|perfect time|sunny outing|summer|winter|seasonal?|weather|range|skin boost|boost it deserves|noticed you enjoyed|hope you(?:'|\u2019)re loving|if you loved|we think you(?:'|\u2019)ll enjoy|we recommend|guaranteed|results?|benefits?|shine brighter|radiance|protect(?:ed|ion|ive)?|deserves a buddy|glow on|waiting for (?:you|more color)|don(?:'|\u2019)t forget|treat yourself|we(?:'|\u2019)d love to see you back|total spend|amount spent|order count|\d+-order journey|days? ago|months? ago|it(?:'|\u2019)s been (?:a while|some time)|we(?:'|\u2019)ve missed you|we miss you)\b/i;

const unsafeBriefPattern =
  /\{\{|total[_ ]spend|amount spent|order[_ ]count|database|segment|customer id|from \{\{city\}\}/i;

const messageFrames: Record<
  FrameId,
  (name: string, product: string, category: string) => string
> = {
  "product-inspired": (name, product) =>
    `Hi ${name}, your ${product} pick inspired this offer.`,
  "after-product": (name, product, category) =>
    `${name}, after ${product}, here is something for your next ${category} pick.`,
  "product-note": (name, product) =>
    `Hello ${name}, here is a GlowCare offer inspired by ${product}.`,
  "purchase-inspired": (name, product) =>
    `For you, ${name}: an offer inspired by your ${product} purchase.`,
  "category-return": (name, product, category) =>
    `${name}, ready for another ${category} find after ${product}?`,
  "next-category": (name, product, category) =>
    `Hi ${name}, ${product} made us think of your next ${category} pick.`,
  "simple-product": (name, product) =>
    `${name}, your ${product} purchase inspired a GlowCare offer.`,
  "category-find": (name, product, category) =>
    `Hello ${name}, here is something for your next ${category} find after ${product}.`,
  "explore-category": (name, product, category) =>
    `${name}, one more reason to explore ${category} after your ${product} pick.`,
  "latest-pick": (name, product, category) =>
    `Hi ${name}, ${product} was your latest ${category} pick.`,
};

const standardInvitations: Record<InvitationId, string> = {
  "discover-next": "Come discover your next GlowCare favorite.",
  "take-another-look": "Take another look at GlowCare.",
  "find-next": "Find your next GlowCare pick.",
  "browse-glowcare": "Browse GlowCare and see what catches your eye.",
  "next-favorite": "Your next GlowCare favorite could be waiting.",
  "return-when-ready": "Come back when you are ready for your next pick.",
};

function shortName(customer: CustomerSummary): string {
  return customer.name.trim().split(/\s+/)[0] || "there";
}

function seededHash(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

function cleanMessage(message: string): string {
  return message
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\bsamples\b/gi, "complimentary products")
    .replace(/\bsample\b/gi, "complimentary product")
    .replace(/\s+/g, " ");
}

function extractOffer(creativeBrief: string): string | null {
  const bundlePatterns = [
    /\bbuy\s+[^.!?]{1,100}\s+and\s+get\s+[^.!?]{1,100}\s+free\b/i,
    /\bbuy\s+[^.!?]{1,100}\s+and\s+add\s+[^.!?]{1,100}\s+for\s+(?:\u20b9|rs\.?|inr|\$|\u20ac|\u00a3)\s?\d+(?:\.\d{1,2})?\b/i,
  ];
  const offerPatterns = [
    /\b\d{1,3}%\s*off\b/i,
    /\bfree shipping\b/i,
    /\bbuy one(?:,? get| and get) one(?: free)?\b/i,
    /\b(?:\u20b9|rs\.?|inr|\$|\u20ac|\u00a3)\s?\d+(?:\.\d{1,2})?\s*off\b/i,
  ];

  for (const pattern of [...bundlePatterns, ...offerPatterns]) {
    const match = creativeBrief.match(pattern);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  const incentiveSentence = creativeBrief
    .split(/(?<=[.!?])\s+/)
    .find((sentence) =>
      /\b(points?|credits?|discount|complimentary|gift|bonus|bundle|free delivery|free shipping|offer)\b/i.test(
        sentence,
      ),
    );
  if (incentiveSentence) return cleanMessage(incentiveSentence).slice(0, 300);
  return null;
}

function sanitizeCampaignDirection(creativeBrief: string): string | null {
  const safeSentences = creativeBrief
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !unsafeBriefPattern.test(sentence));
  const direction = cleanMessage(safeSentences.join(" ")).slice(0, 300);
  return direction || null;
}

function customerFacingCampaign(campaign: RecipientMessageCampaign) {
  return {
    goal: campaign.goal,
    channel: campaign.channel,
    direction: sanitizeCampaignDirection(campaign.creativeBrief),
    offer: extractOffer(campaign.creativeBrief),
  };
}

function personalizationReason(customer: CustomerSummary): string {
  const category =
    customer.recentOrders[0]?.category ?? customer.lastPurchaseCategory ?? "GlowCare";
  return `Uses the shopper's latest ${category} purchase without exposing spend, order counts, location, or purchase timing.`;
}

function renderRecipientMessage(
  campaign: RecipientMessageCampaign,
  customer: CustomerSummary,
  frameId: FrameId,
  invitationId: InvitationId,
  source: GeneratedRecipientMessage["source"],
): GeneratedRecipientMessage {
  const firstName = shortName(customer);
  const lastOrder = customer.recentOrders[0];
  const lastCategory = lastOrder?.category ?? customer.lastPurchaseCategory ?? "self-care";
  const lastProduct = lastOrder?.productName ?? lastCategory;
  const offer = extractOffer(campaign.creativeBrief);
  const offerSentence = offer
    ? `${offer.replace(/[.!?]+$/, "")}.`
    : "";
  const invitation = offer
    ? `${offerSentence} ${standardInvitations[invitationId]}`
    : standardInvitations[invitationId];

  return {
    customerId: customer.id,
    message: cleanMessage(
      `${messageFrames[frameId](firstName, lastProduct, lastCategory)} ${invitation}`,
    ),
    reason: personalizationReason(customer),
    source,
  };
}

function isGroundedGeneratedMessage(
  message: string,
  campaign: RecipientMessageCampaign,
  customer: CustomerSummary,
): boolean {
  const normalized = message.toLowerCase();
  const maxLength = campaign.channel === "email" ? 700 : 380;
  const sentenceCount = message.split(/[.!?]+/).filter((part) => part.trim()).length;
  const knownReferences = [
    shortName(customer),
    ...customer.categoriesPurchased,
    ...customer.recentOrders.map((order) => order.productName),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  return (
    message.length <= maxLength &&
    sentenceCount >= 2 &&
    sentenceCount <= 3 &&
    !message.includes("{{") &&
    !/\bsamples?\b/i.test(message) &&
    !unsupportedClaimPattern.test(message) &&
    preservesCommercialTerms(message, campaign.creativeBrief) &&
    knownReferences.some((reference) => normalized.includes(reference))
  );
}

function preservesCommercialTerms(message: string, creativeBrief: string): boolean {
  const normalizedMessage = message.toLowerCase().replace(/\s+/g, "");
  const commercialTerms =
    creativeBrief.match(/(?:\u20b9|rs\.?|inr|\$|\u20ac|\u00a3)?\s?\d+(?:\.\d+)?%?/gi) ?? [];
  return commercialTerms.every((term) =>
    normalizedMessage.includes(term.toLowerCase().replace(/\s+/g, "")),
  );
}

export function createJourneyFallbackMessage(
  campaign: RecipientMessageCampaign,
  customer: CustomerSummary,
  variation = 0,
): GeneratedRecipientMessage {
  const seed = seededHash(`${customer.id}:${campaign.name}:${variation}`);
  const frameId = frameIds[seed % frameIds.length]!;
  const invitationId = invitationIds[Math.floor(seed / 31) % invitationIds.length]!;
  return renderRecipientMessage(campaign, customer, frameId, invitationId, "fallback");
}

function recipientContext(customer: CustomerSummary) {
  const lastOrder = customer.recentOrders[0];
  return {
    customerId: customer.id,
    firstName: shortName(customer),
    latestPurchase: lastOrder
      ? {
          productName: lastOrder.productName,
          category: lastOrder.category,
        }
      : customer.lastPurchaseCategory
        ? { category: customer.lastPurchaseCategory }
        : null,
    categoriesPurchased: customer.categoriesPurchased.slice(0, 3),
  };
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

async function generateOpenAiBatch(
  campaign: RecipientMessageCampaign,
  customers: CustomerSummary[],
): Promise<GeneratedRecipientMessage[]> {
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
        "Write the final customer-facing GlowCare marketing message for every supplied customerId.",
        "Return a genuinely different message for each shopper; vary the opening, rhythm, product connection, and call to action.",
        "Use 2-3 concise sentences. For WhatsApp, SMS, or RCS target roughly 180-360 characters; for email target 220-650 characters.",
        "Use the supplied firstName and naturally connect the campaign to the latest purchase product or category.",
        "Treat the campaign direction and incentive as marketer-approved. Preserve all named products and every number, percentage, point, credit, or currency term without changing the commercial promise.",
        "Never use the words sample or samples. Use complimentary gift, discovery product, bonus item, featured pair, or other natural wording when appropriate.",
        "Make the copy warm and attractive with a clear call to action, but do not invent product benefits, urgency, scarcity, stock, dates, or extra offers.",
        "Never mention spend, amount, order count, location, inactivity, elapsed time, segmentation, CRM data, or database information.",
        "Do not output placeholders, markdown, explanations, or reasons.",
      ].join(" "),
      input: JSON.stringify({
        campaign: customerFacingCampaign(campaign),
        recipients: customers.map(recipientContext),
      }),
      max_output_tokens: Math.max(700, customers.length * 80),
      text: {
        format: {
          type: "json_schema",
          name: "recipient_messages",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              messages: {
                type: "array",
                minItems: customers.length,
                maxItems: customers.length,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    customerId: { type: "string" },
                    message: { type: "string" },
                  },
                  required: ["customerId", "message"],
                },
              },
            },
            required: ["messages"],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
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

  const parsed = generatedBatchSchema.parse(JSON.parse(responseText));
  const expectedIds = new Set(customers.map((customer) => customer.id));
  const returnedIds = new Set(parsed.messages.map((message) => message.customerId));
  if (
    parsed.messages.length !== customers.length ||
    returnedIds.size !== customers.length ||
    [...expectedIds].some((id) => !returnedIds.has(id))
  ) {
    throw new Error("OpenAI returned an incomplete or mismatched recipient batch.");
  }

  return parsed.messages.map((generated) => {
    const customer = customers.find((item) => item.id === generated.customerId);
    if (!customer) {
      throw new Error(`OpenAI returned an unknown customerId '${generated.customerId}'.`);
    }
    const message: GeneratedRecipientMessage = {
      customerId: customer.id,
      message: cleanMessage(generated.message),
      reason: personalizationReason(customer),
      source: "openai",
    };
    if (!isGroundedGeneratedMessage(message.message, campaign, customer)) {
      logger.warn(
        { customerId: customer.id },
        "Generated recipient message failed grounding checks; using fallback",
      );
      return createJourneyFallbackMessage(campaign, customer);
    }
    return message;
  });
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await task(value);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageStructure(
  message: string,
  customer: CustomerSummary | undefined,
): Set<string> {
  let normalized = message.toLowerCase();
  if (customer) {
    const personalValues = [
      shortName(customer),
      ...customer.categoriesPurchased,
      ...customer.recentOrders.map((order) => order.productName),
    ]
      .filter(Boolean)
      .sort((first, second) => second.length - first.length);
    for (const value of personalValues) {
      normalized = normalized.replace(new RegExp(escapeRegExp(value.toLowerCase()), "g"), " ");
    }
  }
  return new Set(
    (normalized.match(/[a-z]+/g) ?? []).filter(
      (word) => word.length > 2 && !["the", "your", "and", "for", "with"].includes(word),
    ),
  );
}

function jaccardSimilarity(first: Set<string>, second: Set<string>): number {
  if (first.size === 0 || second.size === 0) return 0;
  let overlap = 0;
  for (const word of first) {
    if (second.has(word)) overlap += 1;
  }
  return overlap / new Set([...first, ...second]).size;
}

function enforceUniqueMessages(
  messages: GeneratedRecipientMessage[],
  customersById: Map<string, CustomerSummary>,
  campaign: RecipientMessageCampaign,
): GeneratedRecipientMessage[] {
  const seen = new Set<string>();
  const structures: Set<string>[] = [];

  // Strip shopper-specific terms before comparison so superficial
  // personalization cannot hide repeated campaign copy.
  return messages.map((message) => {
    const customer = customersById.get(message.customerId);
    const normalized = message.message.toLowerCase().replace(/\W/g, "");
    const structure = messageStructure(message.message, customer);
    const tooSimilar = structures.some(
      (previous) => jaccardSimilarity(previous, structure) >= 0.72,
    );

    if (!seen.has(normalized) && !tooSimilar) {
      seen.add(normalized);
      structures.push(structure);
      return message;
    }

    if (!customer) return message;
    let replacement = createJourneyFallbackMessage(campaign, customer);
    for (let variation = 1; variation < 24; variation += 1) {
      const replacementKey = replacement.message.toLowerCase().replace(/\W/g, "");
      const replacementStructure = messageStructure(replacement.message, customer);
      const replacementTooSimilar = structures.some(
        (previous) => jaccardSimilarity(previous, replacementStructure) >= 0.72,
      );
      if (!seen.has(replacementKey) && !replacementTooSimilar) break;
      replacement = createJourneyFallbackMessage(campaign, customer, variation);
    }
    seen.add(replacement.message.toLowerCase().replace(/\W/g, ""));
    structures.push(messageStructure(replacement.message, customer));
    return replacement;
  });
}

export async function generateRecipientMessages(
  campaign: RecipientMessageCampaign,
  customers: CustomerSummary[],
): Promise<GeneratedRecipientMessage[]> {
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  if (config.aiProvider.toLowerCase() !== "openai" || !config.openAiApiKey) {
    return enforceUniqueMessages(
      customers.map((customer) => createJourneyFallbackMessage(campaign, customer)),
      customersById,
      campaign,
    );
  }

  const customerBatches = batches(customers, config.aiRecipientBatchSize);
  const generatedBatches = await mapWithConcurrency(
    customerBatches,
    config.aiRecipientConcurrency,
    async (batch) => {
      try {
        return await generateOpenAiBatch(campaign, batch);
      } catch (error) {
        logger.warn(
          { error, recipientCount: batch.length },
          "OpenAI recipient personalization failed; using journey fallback",
        );
        return batch.map((customer) => createJourneyFallbackMessage(campaign, customer));
      }
    },
  );

  return enforceUniqueMessages(generatedBatches.flat(), customersById, campaign);
}
