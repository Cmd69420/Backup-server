// routes/meetings.routes.js
// ✅ FIXED VERSION - Route conflict resolved

import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  blockTrialUserWrites, 
  enforceTrialUserLimits 
} from "../middleware/trialUser.js";
import * as meetingsController from "../controllers/meetings.controller.js";

const router = express.Router();

// ============================================
// MEETING CRUD OPERATIONS
// ============================================

// Start meeting
router.post("/", 
  authenticateToken,
  blockTrialUserWrites,
  asyncHandler(meetingsController.startMeeting)
);

// Get active meeting for client
router.get("/active/:clientId", 
  authenticateToken,
  enforceTrialUserLimits,
  asyncHandler(meetingsController.getActiveMeeting)
);

// Get all meetings (must be BEFORE /:id to avoid route conflicts)
router.get("/", 
  authenticateToken,
  enforceTrialUserLimits,
  asyncHandler(meetingsController.getMeetings)
);

// Get meeting by ID
router.get("/:id", 
  authenticateToken,
  enforceTrialUserLimits,
  asyncHandler(meetingsController.getMeetingById)
);

// Update meeting
router.put("/:id", 
  authenticateToken,
  blockTrialUserWrites,
  asyncHandler(meetingsController.updateMeeting)
);

// Delete meeting
router.delete("/:id", 
  authenticateToken,
  blockTrialUserWrites,
  asyncHandler(meetingsController.deleteMeeting)
);

// ============================================
// ATTACHMENT OPERATIONS
// ============================================

// Upload meeting attachment (base64 JSON format)
router.post("/:meetingId/attachments",
  authenticateToken,
  blockTrialUserWrites,
  asyncHandler(meetingsController.uploadMeetingAttachment)
);

// Delete attachment from meeting
router.delete("/:meetingId/attachments/:attachmentId",
  authenticateToken,
  blockTrialUserWrites,
  asyncHandler(meetingsController.deleteMeetingAttachment)
);

export default router;