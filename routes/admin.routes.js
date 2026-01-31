import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as adminController from "../controllers/admin.controller.js";
import { checkUserQuotaMiddleware } from "../middleware/quotaCheck.js";

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken, requireAdmin);

// ============================================
// EXISTING ROUTES
// ============================================
router.get("/clients", asyncHandler(adminController.getAllClients));
router.get("/users", asyncHandler(adminController.getAllUsers));
router.get("/analytics", asyncHandler(adminController.getAnalytics));
router.get("/clock-status/:userId", asyncHandler(adminController.getClockStatus));
router.get("/expenses/summary", asyncHandler(adminController.getExpensesSummary));
router.get("/check", asyncHandler(adminController.checkAdminStatus));

// ============================================
// USER MANAGEMENT ROUTES
// ============================================
router.post("/users", 
  checkUserQuotaMiddleware,
  asyncHandler(adminController.createUser)
);

router.get("/users/:userId", asyncHandler(adminController.getUserDetails));
router.put("/users/:userId", asyncHandler(adminController.updateUser));
router.delete("/users/:userId", asyncHandler(adminController.deleteUser));
router.post("/users/:userId/reset-password", asyncHandler(adminController.resetUserPassword));

// ============================================
// 🆕 LIVE TRACKER ENDPOINTS
// ============================================

/**
 * GET /api/admin/users/:userId/location-logs
 * Get location logs for live tracking
 */
router.get(
  "/users/:userId/location-logs",
  asyncHandler(adminController.getUserLocationLogs)
);

/**
 * GET /api/admin/users/:userId/meetings
 * Get meetings for live tracking
 */
router.get(
  "/users/:userId/meetings",
  asyncHandler(adminController.getUserMeetings)
);

/**
 * GET /api/admin/users/:userId/expenses
 * Get expenses for live tracking
 */
router.get(
  "/users/:userId/expenses",
  asyncHandler(adminController.getUserExpenses)
);

/**
 * GET /api/admin/users/:userId/quick-visits
 * Get quick visits for live tracking
 */
router.get(
  "/users/:userId/quick-visits",
  asyncHandler(adminController.getUserQuickVisits)
);

/**
 * GET /api/admin/users/:userId/timeline
 * Get comprehensive activity timeline
 */
router.get(
  "/users/:userId/timeline",
  asyncHandler(adminController.getUserTimeline)
);

// ============================================
// DEPRECATED ROUTES (kept for backward compatibility)
// ============================================
// These will be removed in future versions
router.get("/location-logs/:userId", asyncHandler(adminController.getUserLocationLogs));
router.get("/user-meetings/:userId", asyncHandler(adminController.getUserMeetings));
router.get("/user-expenses/:userId", asyncHandler(adminController.getUserExpenses));

export default router;