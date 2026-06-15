import { describe, expect, it } from "vitest";
import { aggregateCampaignStats } from "../src/services/analytics.js";

describe("aggregateCampaignStats", () => {
  it("builds a cumulative funnel from latest statuses", () => {
    const stats = aggregateCampaignStats(5, [
      { currentStatus: "queued" },
      { currentStatus: "delivered" },
      { currentStatus: "read" },
      { currentStatus: "clicked" },
      { currentStatus: "converted" },
    ]);
    expect(stats).toMatchObject({
      audienceSize: 5,
      queued: 1,
      sent: 4,
      delivered: 4,
      opened: 3,
      read: 3,
      clicked: 2,
      converted: 1,
      deliveryRate: 100,
      clickRate: 50,
    });
  });

  it("counts a sent-then-failed communication as sent but not delivered", () => {
    const stats = aggregateCampaignStats(2, [
      { currentStatus: "failed", sentAt: new Date() },
      { currentStatus: "failed" },
    ]);
    expect(stats.sent).toBe(1);
    expect(stats.failed).toBe(2);
    expect(stats.delivered).toBe(0);
  });

  it("avoids divide-by-zero rates", () => {
    const stats = aggregateCampaignStats(0, []);
    expect(stats.deliveryRate).toBe(0);
    expect(stats.readRate).toBe(0);
    expect(stats.clickRate).toBe(0);
    expect(stats.conversionRate).toBe(0);
  });
});
