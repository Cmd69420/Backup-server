// routes/tallySync.routes.js
import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { attachCompanyContext } from "../middleware/company.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as tallySyncController from "../controllers/tallySync.controller.js";

const router = express.Router();

// All routes require authentication + company context
router.use(authenticateToken, attachCompanyContext);

// ============================================
// QUEUE MANAGEMENT
// ============================================
router.get("/queue", 
  requireAdmin,
  asyncHandler(tallySyncController.getSyncQueue)
);

router.get("/stats", 
  requireAdmin,
  asyncHandler(tallySyncController.getSyncStats)
);

router.post("/process", 
  requireAdmin,
  asyncHandler(tallySyncController.processSyncQueue)
);

router.post("/retry/:queueId", 
  requireAdmin,
  asyncHandler(tallySyncController.retrySyncItem)
);

// ============================================
// CONFLICT RESOLUTION
// ============================================
router.get("/conflicts", 
  requireAdmin,
  asyncHandler(tallySyncController.getSyncConflicts)
);

router.post("/conflicts/:conflictId/resolve", 
  requireAdmin,
  asyncHandler(tallySyncController.resolveConflict)
);

// ============================================
// HISTORY & AUDIT
// ============================================
router.get("/history/:clientId", 
  asyncHandler(tallySyncController.getClientSyncHistory)
);

// ============================================
// CONFIGURATION (Admin Only)
// ============================================
router.post("/configure", 
  requireAdmin,
  asyncHandler(tallySyncController.configureTallyCredentials)
);

router.get("/configuration", 
  requireAdmin,
  asyncHandler(tallySyncController.getTallyConfiguration)
);

export default router;