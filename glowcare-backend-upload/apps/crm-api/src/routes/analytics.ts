import type { Order } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { normalizeProductCategory } from "../services/product-categories.js";
import { asyncHandler } from "../utils/async-handler.js";

type ProductTrendOrder = Pick<
  Order,
  "productName" | "category" | "amount" | "orderDate"
>;
type TrendPoint = Record<string, string | number>;

export const analyticsRouter = Router();

analyticsRouter.get(
  "/products",
  asyncHandler(async (_request, response) => {
    const orders = await prisma.order.findMany({
      select: {
        productName: true,
        category: true,
        amount: true,
        orderDate: true,
      },
    });

    const productMap = new Map<
      string,
      { productName: string; category: string; orders: number; revenue: number }
    >();
    for (const order of orders) {
      const category = normalizeProductCategory(order.category, order.productName);
      const existing = productMap.get(order.productName) ?? {
        productName: order.productName,
        category,
        orders: 0,
        revenue: 0,
      };
      existing.orders += 1;
      existing.revenue += Number(order.amount);
      productMap.set(order.productName, existing);
    }

    const products = [...productMap.values()]
      .map((product) => ({
        ...product,
        revenue: Math.round(product.revenue * 10) / 10,
        averageOrderValue:
          product.orders > 0 ? Math.round(product.revenue / product.orders) : 0,
      }))
      .sort((left, right) => right.orders - left.orders);
    const productNames = products.map((product) => product.productName);

    response.json({
      products,
      dailyTrends: getDailyProductTrends(orders, productNames),
      weeklyTrends: getWeeklyProductTrends(orders, productNames),
    });
  }),
);

function initializeProductPoint(
  labelKey: "date" | "week",
  label: string,
  productNames: string[],
): TrendPoint {
  const point: TrendPoint = { [labelKey]: label };
  for (const productName of productNames) {
    point[`${productName}_orders`] = 0;
    point[`${productName}_revenue`] = 0;
  }
  return point;
}

function addOrderToPoint(point: TrendPoint, order: ProductTrendOrder): void {
  const ordersKey = `${order.productName}_orders`;
  const revenueKey = `${order.productName}_revenue`;
  point[ordersKey] = Number(point[ordersKey] ?? 0) + 1;
  point[revenueKey] =
    Math.round((Number(point[revenueKey] ?? 0) + Number(order.amount)) * 10) / 10;
}

function getDailyProductTrends(
  orders: ProductTrendOrder[],
  productNames: string[],
): TrendPoint[] {
  const trends: Record<string, TrendPoint> = {};
  const now = new Date();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    const dateKey = date.toISOString().split("T")[0]!;
    trends[dateKey] = initializeProductPoint(
      "date",
      date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      productNames,
    );
  }

  for (const order of orders) {
    const dateKey = order.orderDate.toISOString().split("T")[0]!;
    const point = trends[dateKey];
    if (point) addOrderToPoint(point, order);
  }
  return Object.values(trends);
}

function getWeeklyProductTrends(
  orders: ProductTrendOrder[],
  productNames: string[],
): TrendPoint[] {
  const trends: Record<string, TrendPoint> = {};
  const now = new Date();

  for (let offset = 3; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset * 7);
    const weekLabel = getWeekLabel(date);
    trends[weekLabel] = initializeProductPoint("week", weekLabel, productNames);
  }

  for (const order of orders) {
    const point = trends[getWeekLabel(order.orderDate)];
    if (point) addOrderToPoint(point, order);
  }
  return Object.values(trends);
}

function getWeekLabel(date: Date): string {
  const startOfWeek = new Date(date);
  const day = startOfWeek.getDay();
  const dateOffset = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(dateOffset);
  return `Wk of ${startOfWeek.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}
