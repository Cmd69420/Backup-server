import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as clientsController from "../controllers/clients.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload-excel", authenticateToken, upload.single("file"), asyncHandler(clientsController.uploadExcel));
router.post("/", authenticateToken, asyncHandler(clientsController.createClient));
router.get("/", authenticateToken, asyncHandler(clientsController.getClients));
router.get("/:id", authenticateToken, asyncHandler(clientsController.getClientById));
router.put("/:id", authenticateToken, asyncHandler(clientsController.updateClient));
router.delete("/:id", authenticateToken, asyncHandler(clientsController.deleteClient));

export default router;