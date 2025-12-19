import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as adminController from "../controllers/admin.controller.js";

const router = express.Router();

// All admin routes require authentication + admin role
router.use(authenticateToken, requireAdmin);

router.get("/clients", asyncHandler(adminController.getAllClients));
router.get("/users", asyncHandler(adminController.getAllUsers));
router.get("/analytics", asyncHandler(adminController.getAnalytics));
router.get("/location-logs/:userId", asyncHandler(adminController.getUserLocationLogs));
router.get("/clock-status/:userId", asyncHandler(adminController.getClockStatus));
router.get("/expenses/summary", asyncHandler(adminController.getExpensesSummary));
router.get("/user-meetings/:userId", asyncHandler(adminController.getUserMeetings));
router.get("/user-expenses/:userId", asyncHandler(adminController.getUserExpenses));
router.get("/check", asyncHandler(adminController.checkAdminStatus));

export default router;