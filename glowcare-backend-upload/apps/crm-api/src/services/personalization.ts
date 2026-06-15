import type { CustomerSummary } from "./customer-summary.js";

const fallbackValues: Record<string, string> = {
  name: "there",
  last_purchase_category: "purchase",
};

export function personalizeMessage(template: string, customer: CustomerSummary): string {
  const values: Record<string, string> = {
    name: customer.name?.split(" ")[0] || fallbackValues.name!,
    last_purchase_category:
      customer.lastPurchaseCategory ?? fallbackValues.last_purchase_category!,
  };

  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    return values[key.toLowerCase()] ?? match;
  });
}
