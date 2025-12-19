import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as authController from "../controllers/auth.controller.js";

const router = express.Router();

router.post("/login", asyncHandler(authController.login));
router.post("/logout", authenticateToken, asyncHandler(authController.logout));
router.post("/signup", asyncHandler(authController.signup));
router.post("/forgot-password", asyncHandler(authController.forgotPassword));
router.post("/reset-password", asyncHandler(authController.resetPassword));
router.get("/profile", authenticateToken, asyncHandler(authController.getProfile));
router.put("/profile", authenticateToken, asyncHandler(authController.updateProfile));
router.post("/clear-pincode", authenticateToken, asyncHandler(authController.clearPincode));
router.get("/verify", authenticateToken, asyncHandler(authController.verifyToken));

export default router;
