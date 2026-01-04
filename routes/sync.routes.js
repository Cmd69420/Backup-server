// routes/sync.routes.js
// UPDATED: Added plan-based Tally integration limitations

import express from "express";
import { authenticateToken, authenticateMiddleware } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireFeature } from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as syncController from "../controllers/sync.controller.js";

const router = express.Router();

// ============================================
// TALLY MIDDLEWARE ENDPOINT (Feature-Gated)
// ============================================
// Tally sync is only available in Business and Enterprise plans
// Business: Hourly sync (60 min intervals)
// Enterprise: Every 30 minutes
router.post("/tally-clients", 
  authenticateMiddleware,
  requireFeature('tallySync'),  // ← NEW: Blocks if Tally not enabled
  asyncHandler(syncController.syncTallyClients)
);

// ============================================
// TALLY CLIENT GUIDS
// ============================================
router.get("/tally-clients/guids", 
  authenticateMiddleware, 
  asyncHandler(syncController.getClientGuids)
);

// ============================================
// USER ENDPOINTS (Require Authentication)
// ============================================
// Get sync status - available to all plans (shows "not available" if disabled)
router.get("/status", 
  authenticateToken, 
  asyncHandler(syncController.getSyncStatus)
);

// Get latest sync - available to all plans
router.get("/latest", 
  authenticateToken, 
  asyncHandler(syncController.getLatestSync)
);

// Trigger manual sync - requires Tally feature
router.post("/trigger", 
  authenticateToken,
  requireFeature('tallySync'),  // ← NEW: Blocks if Tally not enabled
  asyncHandler(syncController.triggerSync)
);

export default router;