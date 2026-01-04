// routes/services.routes.js
// UPDATED: Added plan-based service limitations and feature gating

import express from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  requireFeature, 
  checkServiceCreationLimit 
} from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as servicesController from "../controllers/services.controller.js";

const router = express.Router();

// ============================================
// FEATURE GATE: Services Module
// ============================================
// ⚠️ IMPORTANT: This blocks the ENTIRE services module for Starter plan
// Services are only available in Professional, Business, and Enterprise plans
router.use(
  authenticateToken,
  requireFeature('services')  // ← NEW: Blocks if services not enabled
);

// ============================================
// GET ALL SERVICES (Advanced Analytics Required)
// ============================================
// Viewing all services across all clients requires advanced analytics
// Available in: Business, Enterprise
router.get(
  "/all",
  requireRole(['admin', 'editor']),
  requireFeature('advancedAnalytics'),  // ← NEW: Blocks Starter/Professional
  asyncHandler(servicesController.getAllServices)
);

// ============================================
// GET EXPIRING SERVICES
// ============================================
router.get(
  "/expiring",
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getExpiringServices)
);

// ============================================
// CLIENT-SPECIFIC SERVICES
// ============================================
// Get services for ONE specific client
router.get(
  "/client/:clientId",
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getClientServices)
);

// ============================================
// CREATE SERVICE (With Limits)
// ============================================
// Professional: Max 10 services per client
// Business: Max 50 services per client
// Enterprise: UNLIMITED services per client
router.post(
  "/client/:clientId",
  requireRole(['admin', 'editor']),
  checkServiceCreationLimit,  // ← NEW: Checks service limit per client
  asyncHandler(servicesController.createService)
);

// ============================================
// UPDATE SERVICE
// ============================================
router.put(
  "/:serviceId",
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.updateService)
);

// ============================================
// DELETE SERVICE (Admin Only)
// ============================================
router.delete(
  "/:serviceId",
  requireRole(['admin']),
  asyncHandler(servicesController.deleteService)
);

// ============================================
// SERVICE HISTORY (Feature-Gated)
// ============================================
// Service history tracking requires 'servicesHistory' feature
// Available in: Business, Enterprise
router.get(
  "/:serviceId/history",
  requireRole(['admin', 'editor']),
  requireFeature('servicesHistory'),  // ← NEW: Blocks Starter/Professional
  asyncHandler(servicesController.getServiceHistory)
);

export default router;