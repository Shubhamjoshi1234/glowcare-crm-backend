import { describe, expect, it } from "vitest";
import {
  buildAudienceCandidates,
  percentile,
  selectDiverseCandidates,
} from "../src/services/audience-insight-service.js";
import type { CustomerSummary } from "../src/services/customer-summary.js";

const now = new Date("2026-06-15T00:00:00.000Z");

function customer(
  id: string,
  input: Partial<CustomerSummary> & {
    totalSpend: number;
    orderCount: number;
    lastOrderDate: Date | null;
    categoriesPurchased: string[];
  },
): CustomerSummary {
  return {
    id,
    name: `Customer ${id}`,
    email: null,
    phone: null,
    city: null,
    age: null,
    gender: null,
    preferredChannel: "email",
    createdAt: now,
    updatedAt: now,
    lastPurchaseCategory: input.categoriesPurchased[0] ?? null,
    recentOrders: [],
    ...input,
  };
}

describe("audience insight candidate generation", () => {
  it("uses nearest-rank percentiles", () => {
    expect(percentile([100, 200, 300, 400], 0.75)).toBe(300);
    expect(percentile([], 0.75)).toBe(0);
  });

  it("creates exact editable segment rules with measured counts", () => {
    const customers = [
      customer("1", {
        totalSpend: 10000,
        orderCount: 6,
        lastOrderDate: new Date("2026-02-01T00:00:00.000Z"),
        categoriesPurchased: ["sunscreen"],
      }),
      customer("2", {
        totalSpend: 6000,
        orderCount: 4,
        lastOrderDate: new Date("2026-03-01T00:00:00.000Z"),
        categoriesPurchased: ["sunscreen", "moisturizer"],
      }),
      customer("3", {
        totalSpend: 9000,
        orderCount: 2,
        lastOrderDate: new Date("2026-06-10T00:00:00.000Z"),
        categoriesPurchased: ["moisturizer"],
      }),
      customer("4", {
        totalSpend: 3000,
        orderCount: 2,
        lastOrderDate: new Date("2026-01-10T00:00:00.000Z"),
        categoriesPurchased: ["face wash"],
      }),
      customer("5", {
        totalSpend: 4000,
        orderCount: 2,
        lastOrderDate: new Date("2026-06-01T00:00:00.000Z"),
        categoriesPurchased: ["toner"],
      }),
    ];

    const activity = new Map([
      [
        "1",
        {
          currentOrders: 0,
          previousOrders: 1,
          currentRevenue: 0,
          previousRevenue: 2000,
        },
      ],
      [
        "2",
        {
          currentOrders: 0,
          previousOrders: 2,
          currentRevenue: 0,
          previousRevenue: 3000,
        },
      ],
      [
        "3",
        {
          currentOrders: 1,
          previousOrders: 0,
          currentRevenue: 1000,
          previousRevenue: 0,
        },
      ],
    ]);

    const candidates = buildAudienceCandidates(customers, activity, 90, now);
    const highValueAtRisk = candidates.find(
      (candidate) =>
        candidate.rules.min_total_spend !== undefined &&
        candidate.rules.inactive_days === 90,
    );
    const activeTopValue = candidates.find(
      (candidate) =>
        candidate.rules.min_total_spend !== undefined &&
        candidate.rules.active_within_days === 90,
    );

    expect(highValueAtRisk?.matchedCount).toBe(1);
    expect(highValueAtRisk?.currentPeriodRevenue).toBe(0);
    expect(highValueAtRisk?.previousPeriodRevenue).toBe(2000);
    expect(activeTopValue?.matchedCount).toBe(1);
    expect(candidates.every((candidate) => candidate.matchedCount > 0)).toBe(true);
  });

  it("keeps recommendations behaviorally distinct", () => {
    const customers = [
      customer("1", {
        totalSpend: 10000,
        orderCount: 5,
        lastOrderDate: new Date("2026-01-01T00:00:00.000Z"),
        categoriesPurchased: ["serum"],
      }),
      customer("2", {
        totalSpend: 8000,
        orderCount: 4,
        lastOrderDate: new Date("2026-04-20T00:00:00.000Z"),
        categoriesPurchased: ["sunscreen"],
      }),
      customer("3", {
        totalSpend: 9000,
        orderCount: 5,
        lastOrderDate: new Date("2026-06-10T00:00:00.000Z"),
        categoriesPurchased: ["moisturizer"],
      }),
      customer("4", {
        totalSpend: 3000,
        orderCount: 2,
        lastOrderDate: new Date("2026-02-01T00:00:00.000Z"),
        categoriesPurchased: ["toner"],
      }),
      customer("5", {
        totalSpend: 4000,
        orderCount: 3,
        lastOrderDate: new Date("2026-06-05T00:00:00.000Z"),
        categoriesPurchased: ["face wash"],
      }),
    ];
    const activity = new Map(
      customers.map((shopper) => [
        shopper.id,
        {
          currentOrders: 1,
          previousOrders: 1,
          currentRevenue: 1000,
          previousRevenue: 1000,
        },
      ]),
    );
    const candidates = buildAudienceCandidates(customers, activity, 90, now);
    const selected = selectDiverseCandidates(
      candidates,
      candidates.map((candidate) => candidate.id),
    );

    expect(selected).toHaveLength(3);
    expect(selected.some((candidate) => candidate.kind === "slipping")).toBe(true);
    expect(
      selected.some((candidate) =>
        ["active_high_value", "loyal_active"].includes(candidate.kind),
      ),
    ).toBe(true);
    expect(
      selected.some((candidate) =>
        ["high_value_at_risk", "lapsed_loyal", "inactive"].includes(
          candidate.kind,
        ),
      ),
    ).toBe(true);
  });
});
