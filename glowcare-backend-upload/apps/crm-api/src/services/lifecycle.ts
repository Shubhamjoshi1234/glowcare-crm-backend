import type { CallbackStatus } from "@xeno/shared";

export type CommunicationStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "opened"
  | "read"
  | "clicked"
  | "converted";

export const statusRank: Record<Exclude<CommunicationStatus, "failed">, number> = {
  queued: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  read: 5,
  clicked: 6,
  converted: 7,
};

export function resolveStatusTransition(
  current: CommunicationStatus,
  incoming: CallbackStatus,
): { nextStatus: CommunicationStatus; changed: boolean; note: string } {
  if (current === "converted") {
    return { nextStatus: current, changed: false, note: "Converted is final and cannot be downgraded." };
  }

  if (incoming === "failed") {
    const currentRank = current === "failed" ? 0 : statusRank[current];
    if (currentRank >= statusRank.delivered) {
      return {
        nextStatus: current,
        changed: false,
        note: "Late failure stored without overriding a delivered or engaged status.",
      };
    }
    return {
      nextStatus: "failed",
      changed: current !== "failed",
      note: current === "failed" ? "Failure status already applied." : "Failure status applied.",
    };
  }

  if (current === "failed") {
    if (statusRank[incoming] <= statusRank.sent) {
      return {
        nextStatus: current,
        changed: false,
        note: "Late sent event stored without overriding the final failure.",
      };
    }
    return {
      nextStatus: incoming,
      changed: true,
      note: "A later delivery or engagement event recovered the failed communication.",
    };
  }

  if (statusRank[incoming] > statusRank[current]) {
    return { nextStatus: incoming, changed: true, note: "Higher lifecycle status applied." };
  }

  return {
    nextStatus: current,
    changed: false,
    note:
      statusRank[incoming] === statusRank[current]
        ? "Status already applied."
        : "Out-of-order event stored without downgrading current status.",
  };
}
