import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as locationController from "../controllers/location.controller.js";

const router = express.Router();

router.post("/", authenticateToken, asyncHandler(locationController.createLocationLog));
router.get("/", authenticateToken, asyncHandler(locationController.getLocationLogs));
router.get("/clock-in", authenticateToken, asyncHandler(locationController.getClockIn));

export default router;