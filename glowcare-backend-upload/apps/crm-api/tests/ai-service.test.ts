import { describe, expect, it } from "vitest";
import { createMockDraft } from "../src/services/ai-service.js";

describe("createMockDraft", () => {
  it("creates a substantial editable fallback while preserving approved terms", async () => {
    const offer =
      "Buy Gentle Cloud Cleanser and add Vitamin C Glow Serum for \u20b9100";
    const result = createMockDraft({
      campaignGoal: "Increase serum trial",
      channel: "whatsapp",
      tone: "friendly",
      offer,
      segmentSummary: { matchedCount: 100 },
    });

    expect(result.provider).toBe("mock");
    expect(result.messageTemplate).toContain(offer);
    expect(
      result.messageTemplate.split(/[.!?]+/).filter(Boolean).length,
    ).toBeGreaterThanOrEqual(2);
    expect(result.messageTemplate).not.toMatch(/enjoyed|loved|total spend/i);
  });

  it("removes sample terminology from legacy offers", async () => {
    const result = createMockDraft({
      campaignGoal: "Introduce two products",
      channel: "whatsapp",
      tone: "friendly",
      offer: "Receive both products as free samples",
      segmentSummary: { matchedCount: 100 },
    });

    expect(result.messageTemplate).not.toMatch(/\bsamples?\b/i);
    expect(result.messageTemplate).toMatch(/complimentary products|complimentary gift/i);
  });
});
