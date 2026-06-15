import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { paginationSchema } from "../schemas/common.js";
import { normalizeProductCategory } from "../services/product-categories.js";
import { asyncHandler } from "../utils/async-handler.js";

const querySchema = paginationSchema
  .extend({
    customerId: z.string().trim().optional(),
    search: z.string().trim().optional(),
    category: z.string().trim().optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
  })
  .refine(
    (query) => !query.fromDate || !query.toDate || query.fromDate <= query.toDate,
    {
      message: "From date cannot be later than to date.",
      path: ["fromDate"],
    },
  );

export const ordersRouter = Router();

ordersRouter.get(
  "/options",
  asyncHandler(async (_request, response) => {
    const categories = await prisma.order.findMany({
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    });
    response.json({
      categories: [
        ...new Set(categories.map(({ category }) => normalizeProductCategory(category))),
      ].sort(),
    });
  }),
);

ordersRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const toDate = query.toDate ? new Date(query.toDate) : undefined;
    const category = query.category
      ? normalizeProductCategory(query.category)
      : undefined;
    const normalizedSearch = query.search
      ? normalizeProductCategory(query.search)
      : undefined;
    if (toDate) toDate.setUTCHours(23, 59, 59, 999);

    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(category ? { category } : {}),
      ...(query.search
        ? {
            OR: [
              { productName: { contains: query.search } },
              { category: { contains: query.search } },
              ...(normalizedSearch !== query.search
                ? [{ category: { contains: normalizedSearch } }]
                : []),
              { customer: { name: { contains: query.search } } },
            ],
          }
        : {}),
      ...(query.fromDate || query.toDate
        ? {
            orderDate: {
              ...(query.fromDate ? { gte: query.fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
    };

    const [total, orders] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, city: true },
          },
        },
        orderBy: { orderDate: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    response.json({
      data: orders.map((order) => ({
        ...order,
        category: normalizeProductCategory(order.category, order.productName),
        amount: Number(order.amount),
      })),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),
);
