// routes/services.routes.js - COMPLETE VERSION
import express from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as servicesController from "../controllers/services.controller.js";

const router = express.Router();

// ⚠️ IMPORTANT: Put /all BEFORE /client/:clientId to avoid route conflicts!

// Get ALL services across all clients (NEW - for ClientServicesPage)
router.get(
  "/all",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getAllServices)
);

// Get expiring services
router.get(
  "/expiring",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getExpiringServices)
);

// Get services for ONE specific client (for ClientServicesModal)
router.get(
  "/client/:clientId",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getClientServices)
);

// Create new service for a client
router.post(
  "/client/:clientId",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.createService)
);

// Update service
router.put(
  "/:serviceId",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.updateService)
);

// Delete service (admin only)
router.delete(
  "/:serviceId",
  authenticateToken,
  requireRole(['admin']),
  asyncHandler(servicesController.deleteService)
);

// Get service history
router.get(
  "/:serviceId/history",
  authenticateToken,
  requireRole(['admin', 'editor']),
  asyncHandler(servicesController.getServiceHistory)
);

export default router;