// routes/clients.routes.js
// UPDATED: Added plan-based client and import limitations

import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  checkClientCreationLimit, 
  validateImportBatchSize,
  requireFeature
} from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as clientsController from "../controllers/clients.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// EXCEL IMPORT (With Batch Size Validation)
// ============================================
// Starter: 50 rows max
// Professional: 200 rows max
// Business: 500 rows max
// Enterprise: 1000 rows max
router.post("/upload-excel", 
  authenticateToken, 
  upload.single("file"),
  validateImportBatchSize,  // ← NEW: Checks Excel row count vs plan limit
  asyncHandler(clientsController.uploadExcel)
);

// ============================================
// CLIENT CRUD (With Creation Limit)
// ============================================
// Starter: 100 clients max
// Professional: 500 clients max
// Business: 2000 clients max
// Enterprise: UNLIMITED
router.post("/", 
  authenticateToken,
  checkClientCreationLimit,  // ← NEW: Blocks if client limit reached
  asyncHandler(clientsController.createClient)
);

// These routes don't need special limits
router.get("/", 
  authenticateToken, 
  asyncHandler(clientsController.getClients)
);

router.get("/:id", 
  authenticateToken, 
  asyncHandler(clientsController.getClientById)
);

router.put("/:id", 
  authenticateToken, 
  asyncHandler(clientsController.updateClient)
);

router.delete("/:id", 
  authenticateToken, 
  asyncHandler(clientsController.deleteClient)
);

// ============================================
// ADVANCED FEATURES (Feature-Gated)
// ============================================
// Advanced search - requires 'advancedSearch' feature (Professional+)
router.get("/search/advanced",
  authenticateToken,
  requireFeature('advancedSearch'),  // ← NEW: Blocks Starter plan
  asyncHandler(async (req, res) => {
    // TODO: Implement advanced search with filters, sorting, etc.
    res.json({ 
      message: "Advanced search endpoint",
      filters: req.query 
    });
  })
);

// Bulk operations - requires 'bulkOperations' feature (Business+)
router.post("/bulk/update",
  authenticateToken,
  requireFeature('bulkOperations'),  // ← NEW: Blocks Starter/Professional
  asyncHandler(async (req, res) => {
    // TODO: Implement bulk update
    res.json({ 
      message: "Bulk update endpoint",
      affectedClients: req.body.clientIds?.length || 0
    });
  })
);

router.post("/bulk/delete",
  authenticateToken,
  requireFeature('bulkOperations'),  // ← NEW: Blocks Starter/Professional
  asyncHandler(async (req, res) => {
    // TODO: Implement bulk delete
    res.json({ 
      message: "Bulk delete endpoint",
      affectedClients: req.body.clientIds?.length || 0
    });
  })
);

export default router;