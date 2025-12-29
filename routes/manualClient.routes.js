import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as manualClientController from "../controllers/manualClient.controller.js";

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Create new client (manual entry from app)
router.post("/", asyncHandler(manualClientController.createClient));

// Get all clients
router.get("/", asyncHandler(manualClientController.getClients));

// Get single client by ID
router.get("/:id", asyncHandler(manualClientController.getClientById));

// Update client
router.put("/:id", asyncHandler(manualClientController.updateClient));

// Delete client
router.delete("/:id", asyncHandler(manualClientController.deleteClient));

// Search clients
router.get("/search", asyncHandler(manualClientController.searchClients));

export default router;