import { Router } from "express";
import { seedDemoData } from "../services/seed-service.js";
import { asyncHandler } from "../utils/async-handler.js";

export const seedRouter = Router();

seedRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const result = await seedDemoData(request.query.reset === "true");
    response.status(result.seeded ? 201 : 200).json(result);
  }),
);
