import { describe, expect, it } from "vitest";
import {
  categoryMatches,
  normalizeProductCategory,
} from "../src/services/product-categories.js";

describe("product categories", () => {
  it("uses the product name to replace broad legacy categories", () => {
    expect(normalizeProductCategory("skincare", "Vitamin C Glow Serum")).toBe(
      "serum",
    );
    expect(normalizeProductCategory("skincare", "Night Renewal Cream")).toBe(
      "night cream",
    );
  });

  it("normalizes common category aliases", () => {
    expect(normalizeProductCategory("suncare")).toBe("sunscreen");
    expect(normalizeProductCategory("cleanser")).toBe("face wash");
    expect(normalizeProductCategory("eye-care")).toBe("eye cream");
    expect(normalizeProductCategory("moisturiser")).toBe("moisturizer");
  });

  it("matches filters using simple aliases", () => {
    expect(categoryMatches(["face wash"], "facewash")).toBe(true);
    expect(categoryMatches(["sunscreen"], "sun screen")).toBe(true);
  });
});
