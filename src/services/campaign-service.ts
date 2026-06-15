import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Channel, ChannelSendPayload } from "@xeno/shared";
import { config } from "../config.js";
import { HttpError } from "../errors.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { segmentRulesSchema } from "../schemas/segments.js";
import { getMatchingCustomers } from "./segment-service.js";
import { refreshCampaignStatus } from "./analytics.js";
import { generateRecipientMessages } from "./recipient-message-service.js";

interface DispatchResult {
  communicationId: string;
  accepted: boolean;
  providerMessageId?: string;
  error?: string;
}

async function dispatchOne(payload: ChannelSendPayload): Promise<DispatchResult> {
  try {
    const response = await fetch(`${config.channelServiceUrl}/channel/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.channelRequestTimeoutMs),
    });
    const body = (await response.json().catch(() => ({}))) as {
      accepted?: boolean;
      provider_message_id?: string;
      error?: string;
    };
    if (!response.ok || !body.accepted || !body.provider_message_id) {
      return {
        communicationId: payload.communication_id,
        accepted: false,
        error: body.error ?? `Channel service returned HTTP ${response.status}.`,
      };
    }
    return {
      communicationId: payload.communication_id,
      accepted: true,
      providerMessageId: body.provider_message_id,
    };
  } catch (error) {
    return {
      communicationId: payload.communication_id,
      accepted: false,
      error: error instanceof Error ? error.message : "Channel dispatch failed.",
    };
  }
}

async function dispatchWithConcurrency(
  payloads: ChannelSendPayload[],
  concurrency = 20,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < payloads.length) {
      const index = cursor;
      cursor += 1;
      const payload = payloads[index];
      if (payload) results[index] = await dispatchOne(payload);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, payloads.length) }, () => worker()));
  return results;
}

export async function sendCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { segment: true },
  });
  if (!campaign) throw new HttpError(404, "Campaign not found.");
  if (campaign.status !== "draft") {
    throw new HttpError(409, `Campaign cannot be sent from status '${campaign.status}'.`);
  }
  if (!campaign.messageTemplate.trim()) throw new HttpError(400, "Campaign message is required.");

  const rules = segmentRulesSchema.parse(campaign.segment.rulesJson);
  const audience = await getMatchingCustomers(rules);
  if (audience.length === 0) {
    throw new HttpError(400, "Campaign audience is empty. Adjust the segment before sending.");
  }

  // This compare-and-set claim prevents concurrent requests from launching
  // the same draft campaign more than once.
  const claimed = await prisma.campaign.updateMany({
    where: { id: campaignId, status: "draft" },
    data: { status: "sending", sentAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new HttpError(409, "Campaign launch is already in progress or was already completed.");
  }

  let communicationRows;
  try {
    const generatedMessages = await generateRecipientMessages(
      {
        name: campaign.name,
        goal: campaign.campaignGoal,
        channel: campaign.channel,
        creativeBrief: campaign.messageTemplate,
      },
      audience,
    );
    const generatedByCustomerId = new Map(
      generatedMessages.map((message) => [message.customerId, message]),
    );
    communicationRows = audience.map((customer) => {
      const generated = generatedByCustomerId.get(customer.id);
      if (!generated) {
        throw new Error(`Missing generated message for customer ${customer.id}.`);
      }
      return {
        id: randomUUID(),
        campaignId,
        customerId: customer.id,
        channel: campaign.channel,
        recipientJson: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
        } satisfies Prisma.InputJsonValue,
        personalizedMessage: generated.message,
        personalizationSource: generated.source,
        personalizationReason: generated.reason,
      };
    });

    await prisma.$transaction([
      prisma.campaignAudience.createMany({
        data: audience.map((customer) => ({
          campaignId,
          customerId: customer.id,
          snapshotJson: JSON.parse(JSON.stringify(customer)) as Prisma.InputJsonValue,
        })),
      }),
      prisma.communication.createMany({ data: communicationRows }),
    ]);
  } catch (error) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: "failed" } });
    throw error;
  }

  const payloads: ChannelSendPayload[] = communicationRows.map((communication) => {
    const recipient = communication.recipientJson as ChannelSendPayload["recipient"];
    return {
      communication_id: communication.id,
      campaign_id: campaignId,
      recipient,
      channel: campaign.channel as Channel,
      message: communication.personalizedMessage,
    };
  });

  const results = await dispatchWithConcurrency(payloads);
  await prisma.$transaction(
    results.map((result) =>
      prisma.communication.update({
        where: { id: result.communicationId },
        data: result.accepted
          ? { providerMessageId: result.providerMessageId }
          : {
              currentStatus: "failed",
              failureReason: result.error ?? "Channel service rejected the message.",
              failedAt: new Date(),
            },
      }),
    ),
  );

  const accepted = results.filter((result) => result.accepted).length;
  const rejected = results.length - accepted;
  const status = accepted === 0 ? "failed" : rejected > 0 ? "partially_failed" : "sending";
  await prisma.campaign.updateMany({
    where: { id: campaignId, status: { in: ["sending", "partially_failed"] } },
    data: { status },
  });

  setTimeout(() => {
    void refreshCampaignStatus(campaignId).catch((error) => {
      logger.error({ error, campaignId }, "Failed to settle campaign status");
    });
  }, 16_000);

  logger.info({ campaignId, audienceSize: audience.length, accepted, rejected }, "Campaign dispatched");
  return {
    campaignId,
    audienceSize: audience.length,
    communicationsCreated: communicationRows.length,
    accepted,
    rejected,
    status,
    aiPersonalized: communicationRows.filter(
      (communication) => communication.personalizationSource === "openai",
    ).length,
    fallbackPersonalized: communicationRows.filter(
      (communication) => communication.personalizationSource === "fallback",
    ).length,
  };
}
