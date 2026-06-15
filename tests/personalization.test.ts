import { describe, expect, it } from "vitest";
import { personalizeMessage } from "../src/services/personalization.js";
import type { CustomerSummary } from "../src/services/customer-summary.js";

const customer: CustomerSummary = {
  id: "customer-1",
  name: "Riya Sharma",
  email: "riya@example.com",
  phone: "9876543210",
  city: "Delhi",
  age: 29,
  gender: "female",
  preferredChannel: "whatsapp",
  createdAt: new Date(),
  updatedAt: new Date(),
  totalSpend: 4280.5,
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
};

describe("personalizeMessage", () => {
  it("renders only customer-safe message variables", () => {
    const result = personalizeMessage(
      "{{name}}, here is something for your next {{last_purchase_category}} pick.",
      customer,
    );
    expect(result).toBe("Riya, here is something for your next skincare pick.");
  });

  it("uses safe fallbacks for missing optional values", () => {
    const result = personalizeMessage("Hi {{name}}, revisit your {{last_purchase_category}}.", {
      ...customer,
      name: "",
      lastPurchaseCategory: null,
    });
    expect(result).toBe("Hi there, revisit your purchase.");
  });
});
