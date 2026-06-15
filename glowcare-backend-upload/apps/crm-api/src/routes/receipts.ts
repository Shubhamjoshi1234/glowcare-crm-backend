import { Prisma } from "@prisma/client";
import { Router } from "express";
import type { CallbackStatus } from "@xeno/shared";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { receiptSchema } from "../schemas/receipts.js";
import { refreshCampaignStatus } from "../services/analytics.js";
import { resolveStatusTransition } from "../services/lifecycle.js";
import { asyncHandler } from "../utils/async-handler.js";

const timestampFields: Partial<Record<CallbackStatus, string>> = {
  sent: "sentAt",
  delivered: "deliveredAt",
  failed: "failedAt",
  opened: "openedAt",
  read: "readAt",
  clicked: "clickedAt",
  converted: "convertedAt",
};

export const receiptsRouter = Router();

receiptsRouter.post(
  "/channel-callback",
  asyncHandler(async (request, response) => {
    const payload = receiptSchema.parse(request.body);
    const duplicate = await prisma.receiptEvent.findUnique({ where: { eventId: payload.event_id } });
    if (duplicate) {
      response.json({ duplicate: true, processed: duplicate.processed });
      return;
    }

    const communication = await prisma.communication.findUnique({
      where: { id: payload.communication_id },
    });

    if (!communication) {
      try {
        await prisma.receiptEvent.create({
          data: {
            eventId: payload.event_id,
            status: payload.status,
            rawPayload: payload as unknown as Prisma.InputJsonValue,
            processed: false,
            processingNote: `Unknown communication ID: ${payload.communication_id}`,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          response.json({ duplicate: true, processed: false });
          return;
        }
        throw error;
      }
      response.status(404).json({ error: "Unknown communication ID.", stored: true });
      return;
    }

    const providerIdMismatch =
      communication.providerMessageId &&
      payload.provider_message_id &&
      communication.providerMessageId !== payload.provider_message_id;
    const campaignIdMismatch = communication.campaignId !== payload.campaign_id;
    if (campaignIdMismatch || providerIdMismatch) {
      const processingNote = campaignIdMismatch
        ? "Callback campaign ID does not match the communication."
        : "Callback provider message ID does not match the communication.";
      try {
        await prisma.receiptEvent.create({
          data: {
            eventId: payload.event_id,
            communicationId: communication.id,
            campaignId: communication.campaignId,
            status: payload.status,
            rawPayload: payload as unknown as Prisma.InputJsonValue,
            processed: false,
            processingNote,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          response.json({ duplicate: true, processed: false });
          return;
        }
        throw error;
      }
      response.status(409).json({ error: processingNote, stored: true });
      return;
    }

    const transition = resolveStatusTransition(
      communication.currentStatus as Parameters<typeof resolveStatusTransition>[0],
      payload.status,
    );
    const eventTime = new Date(payload.timestamp);
    const timestampField = timestampFields[payload.status] as
      | keyof Pick<
          typeof communication,
          "sentAt" | "deliveredAt" | "failedAt" | "openedAt" | "readAt" | "clickedAt" | "convertedAt"
        >
      | undefined;
    const timestampPatch =
      timestampField && communication[timestampField] === null
        ? { [timestampField]: eventTime }
        : {};

    try {
      await prisma.$transaction([
        prisma.receiptEvent.create({
          data: {
            eventId: payload.event_id,
            communicationId: communication.id,
            campaignId: communication.campaignId,
            status: payload.status,
            rawPayload: payload as unknown as Prisma.InputJsonValue,
            processed: true,
            processingNote: transition.note,
          },
        }),
        prisma.communication.update({
          where: { id: communication.id },
          data: {
            ...timestampPatch,
            ...(transition.changed ? { currentStatus: transition.nextStatus } : {}),
            ...(payload.provider_message_id && !communication.providerMessageId
              ? { providerMessageId: payload.provider_message_id }
              : {}),
          },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        response.json({ duplicate: true, processed: false });
        return;
      }
      throw error;
    }

    await refreshCampaignStatus(communication.campaignId);
    logger.info(
      {
        eventId: payload.event_id,
        communicationId: communication.id,
        incoming: payload.status,
        current: transition.nextStatus,
        changed: transition.changed,
      },
      "Receipt processed",
    );
    response.json({
      duplicate: false,
      processed: true,
      statusUpdated: transition.changed,
      currentStatus: transition.nextStatus,
    });
  }),
);
