import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as authController from "../controllers/auth.controller.js";

const router = express.Router();

// ✅ Public routes
router.post("/login", asyncHandler(authController.login));
router.post("/signup", asyncHandler(authController.signup));
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/reset-password", asyncHandler(authController.resetPassword));

// ✅ Trial status (no auth required)
router.get("/trial-status", asyncHandler(authController.getTrialStatus));

// ✅ Protected routes
router.post("/logout", authenticateToken, asyncHandler(authController.logout));
router.get("/profile", authenticateToken, asyncHandler(authController.getProfile));
router.put("/profile", authenticateToken, asyncHandler(authController.updateProfile));
router.post("/clear-pincode", authenticateToken, asyncHandler(authController.clearPincode));
router.get("/verify", authenticateToken, asyncHandler(authController.verifyToken));

// ✅ Admin-only routes
router.get("/trial-stats", authenticateToken, requireAdmin, asyncHandler(authController.getTrialStats));
router.post("/block-device", authenticateToken, requireAdmin, asyncHandler(authController.blockDevice));
router.post("/unblock-device", authenticateToken, requireAdmin, asyncHandler(authController.unblockDevice));

export default router;