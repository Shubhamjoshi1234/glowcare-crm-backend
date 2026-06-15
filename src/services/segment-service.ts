import { prisma } from "../lib/prisma.js";
import type { SegmentRules } from "../schemas/segments.js";
import {
  customerWithOrders,
  summarizeCustomer,
  type CustomerSummary,
} from "./customer-summary.js";
import { categoryMatches } from "./product-categories.js";

export function customerMatchesRules(
  customer: CustomerSummary,
  rules: SegmentRules,
  now = new Date(),
): boolean {
  if (rules.city && customer.city?.toLowerCase() !== rules.city.toLowerCase()) return false;
  if (rules.preferred_channel && customer.preferredChannel !== rules.preferred_channel) return false;
  if (rules.min_total_spend !== undefined && customer.totalSpend < rules.min_total_spend) return false;
  if (rules.max_total_spend !== undefined && customer.totalSpend > rules.max_total_spend) return false;
  if (rules.min_order_count !== undefined && customer.orderCount < rules.min_order_count) return false;
  if (rules.max_order_count !== undefined && customer.orderCount > rules.max_order_count) return false;
  if (
    rules.category_purchased &&
    !categoryMatches(customer.categoriesPurchased, rules.category_purchased)
  ) {
    return false;
  }

  if (rules.inactive_days !== undefined) {
    if (!customer.lastOrderDate) return true;
    const threshold = new Date(now);
    threshold.setUTCDate(threshold.getUTCDate() - rules.inactive_days);
    if (customer.lastOrderDate > threshold) return false;
  }

  if (rules.active_within_days !== undefined) {
    if (!customer.lastOrderDate) return false;
    const threshold = new Date(now);
    threshold.setUTCDate(threshold.getUTCDate() - rules.active_within_days);
    if (customer.lastOrderDate < threshold) return false;
  }

  return true;
}

export async function loadCustomerSummaries(): Promise<CustomerSummary[]> {
  const customers = await prisma.customer.findMany({ include: customerWithOrders });
  return customers.map(summarizeCustomer);
}

export async function getMatchingCustomers(rules: SegmentRules): Promise<CustomerSummary[]> {
  const customers = await loadCustomerSummaries();
  return customers.filter((customer) => customerMatchesRules(customer, rules));
}

function topValues(values: Array<string | null>, limit = 3) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

export function summarizeSegment(customers: CustomerSummary[]) {
  const divisor = customers.length || 1;
  return {
    averageSpend: customers.reduce((sum, customer) => sum + customer.totalSpend, 0) / divisor,
    averageOrderCount: customers.reduce((sum, customer) => sum + customer.orderCount, 0) / divisor,
    topCities: topValues(customers.map((customer) => customer.city)),
    topCategories: topValues(customers.flatMap((customer) => customer.categoriesPurchased)),
  };
}
