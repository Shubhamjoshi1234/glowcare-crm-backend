import { randomUUID } from "node:crypto";
import type { CallbackStatus, ChannelSendPayload, ReceiptPayload } from "@xeno/shared";
import { config } from "./config.js";
import { logger } from "./logger.js";

const retryDelays = [2000, 5000, 10000];

function randomDelay(minimum: number, maximum: number) {
  return Math.floor(minimum + Math.random() * (maximum - minimum));
}

async function deliverCallback(payload: ReceiptPayload, attempt = 1): Promise<void> {
  try {
    const response = await fetch(config.callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        metadata: { ...payload.metadata, attempt },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      logger.info(
        { eventId: payload.event_id, status: payload.status, attempt },
        "Callback delivered",
      );
      return;
    }
    if (response.status < 500) {
      logger.warn(
        { eventId: payload.event_id, status: payload.status, attempt, httpStatus: response.status },
        "Callback rejected without retry",
      );
      return;
    }
    throw new Error(`CRM returned HTTP ${response.status}.`);
  } catch (error) {
    const retryDelay = retryDelays[attempt - 1];
    if (retryDelay === undefined) {
      logger.error({ error, eventId: payload.event_id, attempt }, "Callback retries exhausted");
      return;
    }
    logger.warn(
      { error, eventId: payload.event_id, attempt, retryInMs: retryDelay },
      "Callback failed; retry scheduled",
    );
    setTimeout(() => void deliverCallback(payload, attempt + 1), retryDelay);
  }
}

function scheduleStatus(
  request: ChannelSendPayload,
  providerMessageId: string,
  status: CallbackStatus,
  delay: number,
) {
  // Callback retries reuse this ID, allowing the CRM to process them
  // idempotently as one receipt event.
  const eventId = `evt_${randomUUID()}`;
  setTimeout(() => {
    void deliverCallback({
      event_id: eventId,
      communication_id: request.communication_id,
      campaign_id: request.campaign_id,
      provider_message_id: providerMessageId,
      status,
      timestamp: new Date().toISOString(),
      metadata: { simulator: "xeno-stub" },
    });
  }, delay);
}

export function simulateLifecycle(request: ChannelSendPayload, providerMessageId: string) {
  scheduleStatus(request, providerMessageId, "sent", randomDelay(500, 1000));

  const failed = Math.random() < 0.12;
  if (failed) {
    scheduleStatus(request, providerMessageId, "failed", randomDelay(2000, 4000));
    return;
  }

  scheduleStatus(request, providerMessageId, "delivered", randomDelay(2000, 4000));
  const converted = Math.random() < 0.08;
  const clicked = converted || Math.random() < 0.25;
  const engaged = clicked || Math.random() < 0.6;

  if (engaged) {
    scheduleStatus(request, providerMessageId, "opened", randomDelay(4000, 5500));
    scheduleStatus(request, providerMessageId, "read", randomDelay(5600, 7000));
  }
  if (clicked) {
    scheduleStatus(request, providerMessageId, "clicked", randomDelay(7000, 10000));
  }
  if (converted) {
    scheduleStatus(request, providerMessageId, "converted", randomDelay(10000, 14000));
  }
}
