// routes/sync.routes.js
// FIXED: Removed company context middleware from middleware endpoints

import express from "express";
import { authenticateToken, authenticateMiddleware } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireFeature } from "../middleware/featureAuth.js";
import { requireFullUser } from "../middleware/trialUser.js";
import * as syncController from "../controllers/sync.controller.js";

const router = express.Router();

// ============================================
// TALLY MIDDLEWARE ENDPOINT (Middleware Token Only)
// ============================================
// ✅ FIX: Remove attachCompanyContext - middleware doesn't have user context
router.post("/tally-clients", 
  authenticateMiddleware,  // Only verify middleware token
  asyncHandler(syncController.syncTallyClients)
);

// ============================================
// TALLY CLIENT GUIDS (Middleware Token Only)
// ============================================
router.get("/tally-clients/guids", 
  authenticateMiddleware,  // Only verify middleware token
  asyncHandler(syncController.getClientGuids)
);

// ============================================
// GET SYNC STATUS (User Authenticated)
// ============================================
router.get("/status", 
  authenticateToken,
  asyncHandler(syncController.getSyncStatus)
);

// ============================================
// GET LATEST SYNC (User Authenticated)
// ============================================
router.get("/latest", 
  authenticateToken,
  asyncHandler(syncController.getLatestSync)
);

// ============================================
// TRIGGER MANUAL SYNC (User Authenticated + Feature Check)
// ============================================
router.post("/trigger", 
  authenticateToken,
  requireFeature('tallySync'),
  requireFullUser,
  asyncHandler(syncController.triggerSync)
);

export default router;
