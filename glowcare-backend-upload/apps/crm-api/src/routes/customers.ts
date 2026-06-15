import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { prisma } from "../lib/prisma.js";
import { channelSchema, paginationSchema } from "../schemas/common.js";
import { customerWithOrders, summarizeCustomer } from "../services/customer-summary.js";
import { normalizeProductCategory } from "../services/product-categories.js";
import { asyncHandler } from "../utils/async-handler.js";

const querySchema = paginationSchema.extend({
  search: z.string().trim().optional(),
  city: z.string().trim().optional(),
  preferredChannel: channelSchema.optional(),
});

const orderImportSchema = z.object({
  productName: z.string().trim().min(1),
  category: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  orderDate: z.coerce.date(),
});

const customerImportSchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().email().optional().nullable(),
    phone: z.string().trim().min(7).optional().nullable(),
    city: z.string().trim().optional().nullable(),
    age: z.coerce.number().int().min(13).max(120).optional().nullable(),
    gender: z.string().trim().optional().nullable(),
    preferredChannel: channelSchema,
    orders: z.array(z.unknown()).optional().default([]),
  })
  .strict();

export const customersRouter = Router();

customersRouter.get(
  "/options",
  asyncHandler(async (_request, response) => {
    const cities = await prisma.customer.findMany({
      where: { city: { not: null } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    });

    response.json({
      cities: cities.flatMap(({ city }) => (city ? [city] : [])),
      channels: ["whatsapp", "sms", "email", "rcs"],
    });
  }),
);

customersRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const where = {
      ...(query.city ? { city: query.city } : {}),
      ...(query.preferredChannel ? { preferredChannel: query.preferredChannel } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { email: { contains: query.search } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [total, customers] = await prisma.$transaction([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: customerWithOrders,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);

    response.json({
      data: customers.map(summarizeCustomer),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  }),
);

customersRouter.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const customer = await prisma.customer.findUnique({
      where: { id: request.params.id as string },
      include: {
        orders: { orderBy: { orderDate: "desc" } },
        communications: {
          include: {
            campaign: { select: { id: true, name: true, channel: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!customer) throw new HttpError(404, "Customer not found.");

    response.json({
      customer: summarizeCustomer(customer),
      orders: customer.orders.map((order) => ({
        ...order,
        category: normalizeProductCategory(order.category, order.productName),
        amount: Number(order.amount),
      })),
      communications: customer.communications,
    });
  }),
);

customersRouter.post(
  "/import",
  asyncHandler(async (request, response) => {
    if (!Array.isArray(request.body)) {
      response.status(400).json({ error: "Expected an array of customers." });
      return;
    }

    const report = {
      createdCustomers: 0,
      createdOrders: 0,
      skippedDuplicates: 0,
      errors: [] as Array<{ index: number; message: string }>,
    };

    for (const [index, rawCustomer] of request.body.entries()) {
      const parsed = customerImportSchema.safeParse(rawCustomer);
      if (!parsed.success) {
        report.errors.push({ index, message: parsed.error.issues.map((issue) => issue.message).join(", ") });
        continue;
      }

      const customer = parsed.data;
      const duplicateConditions = [
        ...(customer.email ? [{ email: customer.email.toLowerCase() }] : []),
        ...(customer.phone ? [{ phone: customer.phone }] : []),
      ];
      const duplicate =
        duplicateConditions.length > 0
          ? await prisma.customer.findFirst({ where: { OR: duplicateConditions } })
          : null;

      if (duplicate) {
        report.skippedDuplicates += 1;
        continue;
      }

      const validOrders = customer.orders.flatMap((order, orderIndex) => {
        const orderResult = orderImportSchema.safeParse(order);
        if (!orderResult.success) {
          report.errors.push({
            index,
            message: `Order ${orderIndex + 1}: ${orderResult.error.issues.map((issue) => issue.message).join(", ")}`,
          });
          return [];
        }
        return [
          {
            ...orderResult.data,
            category: normalizeProductCategory(
              orderResult.data.category,
              orderResult.data.productName,
            ),
          },
        ];
      });

      await prisma.customer.create({
        data: {
          name: customer.name,
          email: customer.email?.toLowerCase() ?? null,
          phone: customer.phone ?? null,
          city: customer.city,
          age: customer.age,
          gender: customer.gender,
          preferredChannel: customer.preferredChannel,
          orders: {
            create: validOrders,
          },
        },
      });
      report.createdCustomers += 1;
      report.createdOrders += validOrders.length;
    }

    response.status(201).json(report);
  }),
);
