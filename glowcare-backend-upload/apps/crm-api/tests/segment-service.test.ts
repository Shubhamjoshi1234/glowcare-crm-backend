import { describe, expect, it } from "vitest";
import type { CustomerSummary } from "../src/services/customer-summary.js";
import { customerMatchesRules } from "../src/services/segment-service.js";

const shopper: CustomerSummary = {
  id: "customer-1",
  name: "Aditi Shah",
  email: null,
  phone: "9876543210",
  city: "Delhi",
  age: 31,
  gender: "female",
  preferredChannel: "whatsapp",
  createdAt: new Date(),
  updatedAt: new Date(),
  totalSpend: 6200,
  orderCount: 4,
  lastOrderDate: new Date("2026-02-01T00:00:00.000Z"),
  lastPurchaseCategory: "serum",
  categoriesPurchased: ["serum", "sunscreen"],
  recentOrders: [
    {
      productName: "Vitamin C Glow Serum",
      category: "serum",
      amount: 1800,
      orderDate: new Date("2026-02-01T00:00:00.000Z"),
    },
  ],
};

describe("customerMatchesRules", () => {
  it("combines attributes and purchase behavior with AND semantics", () => {
    expect(
      customerMatchesRules(
        shopper,
        {
          city: "delhi",
          preferred_channel: "whatsapp",
          min_total_spend: 3000,
          max_total_spend: 10000,
          inactive_days: 60,
          active_within_days: 180,
          category_purchased: "SERUM",
          min_order_count: 2,
          max_order_count: 5,
        },
        new Date("2026-06-13T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("rejects a shopper when any configured rule fails", () => {
    expect(
      customerMatchesRules(shopper, { min_order_count: 5 }, new Date("2026-06-13T00:00:00.000Z")),
    ).toBe(false);
  });

  it("understands simple aliases such as facewash", () => {
    expect(
      customerMatchesRules(
        { ...shopper, categoriesPurchased: ["face wash"] },
        { category_purchased: "facewash" },
      ),
    ).toBe(true);
  });

  it("considers a customer with no orders inactive", () => {
    expect(
      customerMatchesRules(
        { ...shopper, lastOrderDate: null, orderCount: 0, totalSpend: 0 },
        { inactive_days: 30 },
        new Date("2026-06-13T00:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("supports active and bounded-frequency audiences", () => {
    expect(
      customerMatchesRules(
        shopper,
        { active_within_days: 180, min_order_count: 3, max_order_count: 4 },
        new Date("2026-06-13T00:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      customerMatchesRules(
        shopper,
        { active_within_days: 30 },
        new Date("2026-06-13T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
