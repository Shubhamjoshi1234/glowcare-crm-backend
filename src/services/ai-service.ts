import { config } from "../config.js";
import { logger } from "../lib/logger.js";

export interface MessageDraftInput {
  campaignGoal: string;
  channel: "whatsapp" | "sms" | "email" | "rcs";
  tone: string;
  offer?: string;
  featuredProducts?: string[];
  segmentSummary: {
    matchedCount: number;
    averageSpend?: number;
    topCategories?: Array<string | { name: string; count?: number }>;
  };
}

function categoryName(value: string | { name: string }): string {
  return typeof value === "string" ? value : value.name;
}

export function createMockDraft(input: MessageDraftInput) {
  const offer = (input.offer?.trim() || "an exclusive GlowCare offer")
    .replace(/\bsamples\b/gi, "complimentary products")
    .replace(/\bsample\b/gi, "complimentary product");
  const category = input.segmentSummary.topCategories?.[0]
    ? categoryName(input.segmentSummary.topCategories[0])
    : "favorites";
  const offerSentence = /[.!?]$/.test(offer) ? offer : `${offer}.`;
  const messageTemplate =
    input.channel === "email"
      ? `Hi {{name}}, we picked something special to complement your next ${category} choice. ${offerSentence} Explore the offer and discover a fresh addition to your GlowCare routine.`
      : `Hi {{name}}, your {{last_purchase_category}} choices inspired something special for you. ${offerSentence} Take a look and discover a fresh addition to your GlowCare routine.`;
  return {
    messageTemplate,
    notes:
      "Fallback draft using the approved incentive, first name, and recent purchase category. The copy remains fully editable.",
    provider: "mock" as const,
  };
}

function cleanGeneratedTemplate(text: string): string {
  const cleaned = text
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\bsamples\b/gi, "complimentary products")
    .replace(/\bsample\b/gi, "complimentary product")
    .replace(/\s+/g, " ");
  return cleaned.includes("{{name}}") ? cleaned : `Hey {{name}}, ${cleaned}`;
}

function commercialTokens(value: string): string[] {
  return value.match(/(?:₹|rs\.?|inr|\$|€|£)?\s?\d+(?:\.\d+)?%?/gi) ?? [];
}

const unsupportedDraftClaimPattern =
  /\b(amazing|benefits?|results?|transform(?:ative|ing)?|radiance|guaranteed|clinically proven|best[- ]selling|limited stock|hurry|ends? today|elevate your skincare)\b/i;

async function createOpenAiDraft(input: MessageDraftInput) {
  const maximumCharacters = input.channel === "email" ? 650 : 360;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openAiModel,
      store: false,
      instructions:
        `Write one polished D2C marketing message template for GlowCare. Return only the template, no markdown. Use 2-3 concise sentences and keep it under ${maximumCharacters} characters. Greet {{name}} naturally and optionally reference {{last_purchase_category}}. Make the opening warm, explain the supplied incentive clearly, and end with a confident call to action. Preserve every product name and every numeric, percentage, point, credit, or currency term from the supplied offer. You may improve the surrounding wording, but never change the commercial promise. Never use the words sample or samples; use complimentary gift, discovery product, bonus item, or another natural phrase if needed. Use no variables except {{name}} and {{last_purchase_category}}. Never mention spend, order count, location, dates, inactivity, elapsed time, segmentation, or database information. Do not invent product benefits, urgency, scarcity, stock, or an additional offer.`,
      input: JSON.stringify(input),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    output_text?: string;
    output?: Array<{
      content?: Array<{ type?: string; text?: string }>;
    }>;
    error?: { message?: string };
  };
  const generatedText =
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text")?.text;
  if (!response.ok || !generatedText) {
    throw new Error(body.error?.message ?? `OpenAI returned HTTP ${response.status}.`);
  }

  const messageTemplate = cleanGeneratedTemplate(generatedText);
  const missingProduct = input.featuredProducts?.find(
    (product) => !messageTemplate.toLowerCase().includes(product.toLowerCase()),
  );
  const compactMessage = messageTemplate.toLowerCase().replace(/\s+/g, "");
  const missingCommercialToken = commercialTokens(input.offer ?? "").find(
    (token) =>
      !compactMessage.includes(token.toLowerCase().replace(/\s+/g, "")),
  );
  const sentenceCount = messageTemplate
    .split(/[.!?]+/)
    .filter((sentence) => sentence.trim()).length;
  if (
    missingProduct ||
    missingCommercialToken ||
    messageTemplate.length > maximumCharacters ||
    sentenceCount < 2 ||
    sentenceCount > 3 ||
    unsupportedDraftClaimPattern.test(messageTemplate) ||
    /\{\{(?!name\}\}|last_purchase_category\}\})/.test(messageTemplate)
  ) {
    throw new Error("OpenAI changed or omitted an approved campaign term.");
  }

  return {
    messageTemplate,
    notes:
      "AI-written from the selected audience, campaign goal, featured products, and editable incentive proposal.",
    provider: "openai" as const,
  };
}

export async function createMessageDraft(input: MessageDraftInput) {
  if (config.aiProvider.toLowerCase() === "openai" && config.openAiApiKey) {
    try {
      return await createOpenAiDraft(input);
    } catch (error) {
      logger.warn({ error }, "OpenAI draft failed; using grounded fallback");
    }
  }
  return createMockDraft(input);
}
