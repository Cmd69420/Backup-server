import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as meetingsController from "../controllers/meetings.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/", authenticateToken, asyncHandler(meetingsController.startMeeting));
router.get("/active/:clientId", authenticateToken, asyncHandler(meetingsController.getActiveMeeting));
router.get("/:id", authenticateToken, asyncHandler(meetingsController.getMeetingById));
router.get("/", authenticateToken, asyncHandler(meetingsController.getMeetings));
router.put("/:id", authenticateToken, asyncHandler(meetingsController.updateMeeting));
router.post("/:id/attachments", authenticateToken, upload.single("file"), asyncHandler(meetingsController.uploadAttachment));
router.delete("/:id", authenticateToken, asyncHandler(meetingsController.deleteMeeting));

export default router;