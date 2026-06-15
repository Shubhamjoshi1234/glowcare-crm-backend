export const CHANNELS = ["whatsapp", "sms", "email", "rcs"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CALLBACK_STATUSES = [
  "sent",
  "delivered",
  "failed",
  "opened",
  "read",
  "clicked",
  "converted",
] as const;
export type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

export interface ChannelSendPayload {
  communication_id: string;
  campaign_id: string;
  recipient: {
    name: string;
    phone?: string | null;
    email?: string | null;
  };
  channel: Channel;
  message: string;
}

export interface ReceiptPayload {
  event_id: string;
  communication_id: string;
  campaign_id: string;
  provider_message_id?: string;
  status: CallbackStatus;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
