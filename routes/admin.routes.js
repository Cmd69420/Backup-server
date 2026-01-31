import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as adminController from "../controllers/admin.controller.js";
import { checkUserQuotaMiddleware } from "../middleware/quotaCheck.js";

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken, requireAdmin);

// Existing routes

router.get("/clients", asyncHandler(adminController.getAllClients));
router.get("/users", asyncHandler(adminController.getAllUsers));
router.get("/analytics", asyncHandler(adminController.getAnalytics));
router.get("/location-logs/:userId", asyncHandler(adminController.getUserLocationLogs));
router.get("/clock-status/:userId", asyncHandler(adminController.getClockStatus));
router.get("/expenses/summary", asyncHandler(adminController.getExpensesSummary));
router.get("/user-meetings/:userId", asyncHandler(adminController.getUserMeetings));
router.get("/user-expenses/:userId", asyncHandler(adminController.getUserExpenses));
router.get("/check", asyncHandler(adminController.checkAdminStatus));

// NEW USER MANAGEMENT ROUTES
router.post("/users", 
  checkUserQuotaMiddleware,  // ← ADD THIS LINE
  asyncHandler(adminController.createUser)
);

/**
 * GET /api/admin/users/:userId/location-logs
 * Get location logs for a specific user
 * Query params: limit, startDate, endDate
 */
router.get(
  "/users/:userId/location-logs",
  asyncHandler(adminController.getUserLocationLogs)
);

/**
 * GET /api/admin/users/:userId/meetings
 * Get meetings for a specific user
 * Query params: limit, page, status, startDate, endDate
 */
router.get(
  "/users/:userId/meetings",
  asyncHandler(adminController.getUserMeetings)
);

/**
 * GET /api/admin/users/:userId/expenses
 * Get expenses for a specific user
 * Query params: limit, page, startDate, endDate
 */
router.get(
  "/users/:userId/expenses",
  asyncHandler(adminController.getUserExpenses)
);

/**
 * GET /api/admin/users/:userId/quick-visits
 * Get quick visits for a specific user
 * Query params: limit, page, startDate, endDate
 */
router.get(
  "/users/:userId/quick-visits",
  asyncHandler(adminController.getUserQuickVisits)
);

/**
 * GET /api/admin/users/:userId/timeline
 * Get comprehensive activity timeline for a user
 * Combines all activities in chronological order
 * Query params: limit, startDate, endDate
 */
router.get(
  "/users/:userId/timeline",
  asyncHandler(adminController.getUserTimeline)
);

router.get("/users/:userId", asyncHandler(adminController.getUserDetails));
router.put("/users/:userId", asyncHandler(adminController.updateUser));
router.delete("/users/:userId", asyncHandler(adminController.deleteUser));
router.post("/users/:userId/reset-password", asyncHandler(adminController.resetUserPassword));

export default router;