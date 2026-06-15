import { describe, expect, it } from "vitest";
import type { CustomerSummary } from "../src/services/customer-summary.js";
import {
  createJourneyFallbackMessage,
  type RecipientMessageCampaign,
} from "../src/services/recipient-message-service.js";

const campaign: RecipientMessageCampaign = {
  name: "Routine refresh",
  goal: "Encourage a thoughtful repeat purchase",
  channel: "whatsapp",
  creativeBrief: "Invite the shopper back with a warm, product-aware recommendation.",
};

function customer(
  overrides: Partial<CustomerSummary> = {},
): CustomerSummary {
  return {
    id: "customer-1",
    name: "Riya Sharma",
    email: "riya@example.com",
    phone: "9876543210",
    city: "Delhi",
    age: 29,
    gender: "female",
    preferredChannel: "whatsapp",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-10T00:00:00.000Z"),
    totalSpend: 4280,
    orderCount: 3,
    lastOrderDate: new Date("2026-01-10T00:00:00.000Z"),
    lastPurchaseCategory: "skincare",
    categoriesPurchased: ["skincare", "cleanser"],
    recentOrders: [
      {
        productName: "Vitamin C Glow Serum",
        category: "skincare",
        amount: 1899,
        orderDate: new Date("2026-01-10T00:00:00.000Z"),
      },
    ],
    ...overrides,
  };
}

describe("createJourneyFallbackMessage", () => {
  it("uses the shopper's product and purchase journey", () => {
    const result = createJourneyFallbackMessage(campaign, customer());

    expect(result.message).toContain("Riya");
    expect(result.message).toContain("Vitamin C Glow Serum");
    expect(result.reason).toContain("without exposing spend");
    expect(result.source).toBe("fallback");
  });

  it("never exposes CRM metrics or legacy template placeholders", () => {
    const result = createJourneyFallbackMessage(
      {
        ...campaign,
        creativeBrief:
          "Hey {{name}} from {{city}}! Enjoy 50% off. Total spend {{total_spend}} across {{order_count}} orders.",
      },
      customer(),
    );

    expect(result.message).toContain("50% off");
    expect(result.message).not.toMatch(/total spend|order count|4280|3 orders/i);
    expect(result.message).not.toContain("Delhi");
    expect(result.message).not.toContain("{{");
    expect(result.message.length).toBeLessThanOrEqual(220);
  });

  it("creates different copy for shoppers with different journeys", () => {
    const first = createJourneyFallbackMessage(campaign, customer());
    const second = createJourneyFallbackMessage(
      campaign,
      customer({
        id: "customer-2",
        name: "Kabir Mehta",
        orderCount: 1,
        lastPurchaseCategory: "suncare",
        categoriesPurchased: ["suncare"],
        recentOrders: [
          {
            productName: "Daily Shield Sunscreen",
            category: "suncare",
            amount: 899,
            orderDate: new Date("2026-05-01T00:00:00.000Z"),
          },
        ],
      }),
    );

    expect(first.message).not.toBe(second.message);
    expect(second.message).toContain("Daily Shield Sunscreen");
  });

  it("preserves an approved bundle offer exactly", () => {
    const offer =
      "Buy Hydra Repair Moisturizer and add Night Renewal Cream for \u20b9100";
    const result = createJourneyFallbackMessage(
      { ...campaign, creativeBrief: offer },
      customer(),
    );

    expect(result.message).toContain(offer);
    expect(result.message).not.toMatch(/total spend|order count|city/i);
  });
});
