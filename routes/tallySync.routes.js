import express from "express";
import { authenticateToken, requireAdmin, authenticateMiddleware } from "../middleware/auth.js";
import { attachCompanyContext } from "../middleware/company.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as tallySyncController from "../controllers/tallySync.controller.js";

const router = express.Router();

// ============================================
// 🔍 DEBUG: Check if authenticateMiddleware is loaded
// ============================================
console.log('\n🔍 TallySync Routes Initialization:');
console.log('   authenticateToken:', typeof authenticateToken);
console.log('   authenticateMiddleware:', typeof authenticateMiddleware);
console.log('   requireAdmin:', typeof requireAdmin);

if (typeof authenticateMiddleware !== 'function') {
  console.error('❌ CRITICAL: authenticateMiddleware is not a function!');
  console.error('   Type:', typeof authenticateMiddleware);
  console.error('   Value:', authenticateMiddleware);
  throw new Error('authenticateMiddleware is not properly exported from auth.js');
}

// ============================================
// MIDDLEWARE POLLING ENDPOINTS (No user auth, uses middleware token)
// ============================================
router.get("/pending-for-middleware",
  (req, res, next) => {
    console.log('\n📍 Route hit: /pending-for-middleware');
    console.log('   Method:', req.method);
    console.log('   Headers:', req.headers);
    next();
  },
  authenticateMiddleware, // ✅ Uses middleware token only
  asyncHandler(tallySyncController.getPendingForMiddleware)
);

router.post("/complete-from-middleware/:queueId",
  (req, res, next) => {
    console.log('\n📍 Route hit: /complete-from-middleware/:queueId');
    console.log('   Method:', req.method);
    console.log('   Headers:', req.headers);
    next();
  },
  authenticateMiddleware, // ✅ Uses middleware token only
  asyncHandler(tallySyncController.completeFromMiddleware)
);

// ============================================
// USER-AUTHENTICATED ROUTES (require JWT + company context)
// ============================================
router.use(authenticateToken, attachCompanyContext); // ← Apply to routes BELOW

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