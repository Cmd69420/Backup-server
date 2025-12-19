import express from "express";
import { authenticateToken, authenticateMiddleware } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as syncController from "../controllers/sync.controller.js";

const router = express.Router();

// Tally middleware endpoint (requires middleware token)
router.post("/tally-clients", authenticateMiddleware, asyncHandler(syncController.syncTallyClients));


//check
router.get("/tally-clients/guids", authenticateMiddleware, asyncHandler(syncController.getClientGuids));

// User endpoints (require authentication)
router.get("/status", authenticateToken, asyncHandler(syncController.getSyncStatus));
router.get("/latest", authenticateToken, asyncHandler(syncController.getLatestSync));
router.post("/trigger", authenticateToken, asyncHandler(syncController.triggerSync));

export default router;
