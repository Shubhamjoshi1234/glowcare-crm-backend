const productCategoryRules: Array<[RegExp, string]> = [
  [/\bserum\b/i, "serum"],
  [/\bmoisturi[sz]er\b/i, "moisturizer"],
  [/\b(?:spf|sunscreen|sun screen)\b/i, "sunscreen"],
  [/\b(?:cleanser|face ?wash)\b/i, "face wash"],
  [/\b(?:lip tint|lipstick|lip gloss)\b/i, "makeup"],
  [/\bnight\b.*\bcream\b/i, "night cream"],
  [/\b(?:eye gel|eye cream)\b/i, "eye cream"],
  [/\btoner\b/i, "toner"],
];

const categoryAliases: Record<string, string> = {
  skincare: "skin care",
  "skin-care": "skin care",
  suncare: "sunscreen",
  "sun-care": "sunscreen",
  "sun screen": "sunscreen",
  cleanser: "face wash",
  facewash: "face wash",
  "face-wash": "face wash",
  "eye-care": "eye cream",
  "eye care": "eye cream",
  moisturiser: "moisturizer",
};

export function normalizeProductCategory(category: string, productName?: string): string {
  if (productName) {
    const productMatch = productCategoryRules.find(([pattern]) => pattern.test(productName));
    if (productMatch) return productMatch[1];
  }

  const normalized = category.trim().toLowerCase().replace(/\s+/g, " ");
  return categoryAliases[normalized] ?? normalized.replaceAll("-", " ");
}

export function categoryMatches(
  purchasedCategories: string[],
  requestedCategory: string,
): boolean {
  const requested = normalizeProductCategory(requestedCategory);
  return purchasedCategories.some(
    (category) => normalizeProductCategory(category) === requested,
  );
}
