// routes/payment.routes.js
// Payment-related API endpoints

import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as paymentController from "../controllers/payment.controller.js";

const router = express.Router();

// Get lms_user_id for payment
// POST /api/payment/get-lms-user-id
router.post("/get-lms-user-id", 
  authenticateToken,  // User must be logged in
  asyncHandler(paymentController.getLmsUserId)
);

export default router;