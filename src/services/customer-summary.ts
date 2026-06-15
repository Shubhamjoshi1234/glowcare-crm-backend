import type { Customer, Order, Prisma } from "@prisma/client";
import type { Channel } from "@xeno/shared";
import { normalizeProductCategory } from "./product-categories.js";

export type CustomerWithOrders = Customer & { orders: Order[] };

export interface CustomerSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  age: number | null;
  gender: string | null;
  preferredChannel: Channel;
  createdAt: Date;
  updatedAt: Date;
  totalSpend: number;
  orderCount: number;
  lastOrderDate: Date | null;
  lastPurchaseCategory: string | null;
  categoriesPurchased: string[];
  recentOrders: Array<{
    productName: string;
    category: string;
    amount: number;
    orderDate: Date;
  }>;
}

export function summarizeCustomer(customer: CustomerWithOrders): CustomerSummary {
  const orders = [...customer.orders].sort(
    (left, right) => right.orderDate.getTime() - left.orderDate.getTime(),
  );
  const categoryFor = (order: Order) =>
    normalizeProductCategory(order.category, order.productName);

  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    city: customer.city,
    age: customer.age,
    gender: customer.gender,
    preferredChannel: customer.preferredChannel as Channel,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    totalSpend: orders.reduce((sum, order) => sum + Number(order.amount), 0),
    orderCount: orders.length,
    lastOrderDate: orders[0]?.orderDate ?? null,
    lastPurchaseCategory: orders[0] ? categoryFor(orders[0]) : null,
    categoriesPurchased: [...new Set(orders.map(categoryFor))],
    recentOrders: orders.slice(0, 5).map((order) => ({
      productName: order.productName,
      category: categoryFor(order),
      amount: Number(order.amount),
      orderDate: order.orderDate,
    })),
  };
}

export const customerWithOrders = {
  orders: {
    orderBy: {
      orderDate: "desc",
    },
  },
} satisfies Prisma.CustomerInclude;
