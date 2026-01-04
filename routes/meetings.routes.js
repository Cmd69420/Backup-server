// routes/meetings.routes.js
// UPDATED: Added plan-based meeting attachment limitations

import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { checkMeetingAttachmentUpload } from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as meetingsController from "../controllers/meetings.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// MEETING CRUD
// ============================================
router.post("/", 
  authenticateToken, 
  asyncHandler(meetingsController.startMeeting)
);

router.get("/active/:clientId", 
  authenticateToken, 
  asyncHandler(meetingsController.getActiveMeeting)
);

router.get("/:id", 
  authenticateToken, 
  asyncHandler(meetingsController.getMeetingById)
);

router.get("/", 
  authenticateToken, 
  asyncHandler(meetingsController.getMeetings)
);

router.put("/:id", 
  authenticateToken, 
  asyncHandler(meetingsController.updateMeeting)
);

router.delete("/:id", 
  authenticateToken, 
  asyncHandler(meetingsController.deleteMeeting)
);

// ============================================
// MEETING ATTACHMENTS (With Limits)
// ============================================
// Starter: 2 attachments per meeting, 5MB each
// Professional: 5 attachments per meeting, 10MB each
// Business: 10 attachments per meeting, 20MB each
// Enterprise: 20 attachments per meeting, 50MB each
router.post("/:id/attachments", 
  authenticateToken, 
  upload.single("file"),
  checkMeetingAttachmentUpload,  // ← NEW: Checks attachment count & file size
  asyncHandler(meetingsController.uploadAttachment)
);

export default router;