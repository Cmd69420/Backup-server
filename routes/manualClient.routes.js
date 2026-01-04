// routes/manualClient.routes.js
// UPDATED: Added plan-based client creation limitations

import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  checkClientCreationLimit,
  requireFeature 
} from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as manualClientController from "../controllers/manualClient.controller.js";

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// ============================================
// CLIENT CRUD (With Creation Limit)
// ============================================
// Starter: 100 clients max
// Professional: 500 clients max
// Business: 2000 clients max
// Enterprise: UNLIMITED
router.post("/", 
  checkClientCreationLimit,  // ← NEW: Checks if client limit reached
  asyncHandler(manualClientController.createClient)
);

// Get all clients
router.get("/", 
  asyncHandler(manualClientController.getClients)
);

// Get single client by ID
router.get("/:id", 
  asyncHandler(manualClientController.getClientById)
);

// Update client
router.put("/:id", 
  asyncHandler(manualClientController.updateClient)
);

// Delete client
router.delete("/:id", 
  asyncHandler(manualClientController.deleteClient)
);

// ============================================
// SEARCH (Feature-Gated)
// ============================================
// Basic search - available to all plans
router.get("/search", 
  asyncHandler(manualClientController.searchClients)
);

// Advanced search with filters - requires 'advancedSearch' feature (Professional+)
router.get("/search/advanced",
  requireFeature('advancedSearch'),  // ← NEW: Blocks Starter plan
  asyncHandler(async (req, res) => {
    // TODO: Implement advanced search with multiple filters
    res.json({ 
      message: "Advanced search with filters",
      filters: req.query 
    });
  })
);

export default router;