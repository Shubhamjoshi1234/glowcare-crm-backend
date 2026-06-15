import { describe, expect, it } from "vitest";
import {
  buildCatalogPerformance,
  buildOpportunityCandidates,
  type ProductPerformance,
} from "../src/services/campaign-opportunity-service.js";

function performance(
  productName: string,
  category: string,
  currentOrders: number,
  customers: string[],
): ProductPerformance {
  return {
    productName,
    category,
    currentOrders,
    previousOrders: currentOrders + 2,
    currentRevenue: currentOrders * 500,
    averageOrderValue: 500,
    currentCustomerIds: new Set(customers),
    analysisCustomerIds: new Set(customers),
  };
}

const products = [
  performance("Hydra Repair Moisturizer", "moisturizer", 50, ["a", "b", "c", "d"]),
  performance("Daily Shield SPF 50", "sunscreen", 40, ["e", "f", "g"]),
  performance("Gentle Cloud Cleanser", "face wash", 35, ["h", "i", "j"]),
  performance("Vitamin C Glow Serum", "serum", 12, ["k"]),
  performance("Night Renewal Cream", "night cream", 8, ["l"]),
];

describe("catalog-wide campaign opportunities", () => {
  it("ranks every product and marks only the bottom two as focus products", () => {
    const catalog = buildCatalogPerformance(products);

    expect(catalog.map((product) => product.productName)).toEqual([
      "Hydra Repair Moisturizer",
      "Daily Shield SPF 50",
      "Gentle Cloud Cleanser",
      "Vitamin C Glow Serum",
      "Night Renewal Cream",
    ]);
    expect(
      catalog.filter((product) => product.status === "focus").map(
        (product) => product.productName,
      ),
    ).toEqual(["Vitamin C Glow Serum", "Night Renewal Cream"]);
  });

  it("uses the same bottom-two focus pair across distinct strong anchors", () => {
    const candidates = buildOpportunityCandidates(products);

    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(
      candidates.slice(0, 3).map((candidate) => candidate.anchor.productName),
    ).toHaveLength(3);
    expect(
      new Set(candidates.slice(0, 3).map((candidate) => candidate.anchor.productName))
        .size,
    ).toBe(3);
    for (const candidate of candidates.slice(0, 3)) {
      expect(
        candidate.featuredProducts.map((product) => product.productName),
      ).toEqual([
        "Night Renewal Cream",
        "Vitamin C Glow Serum",
      ]);
    }
  });
});
