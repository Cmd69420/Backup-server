// routes/clients.routes.js
import express from "express";
import multer from "multer";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  validateImportBatchSize,
  requireFeature
} from "../middleware/featureAuth.js";
import { attachCompanyContext } from "../middleware/company.js";
import { 
  blockTrialUserWrites, 
  enforceTrialUserLimits 
} from "../middleware/trialUser.js";
import * as clientsController from "../controllers/clients.controller.js";
import { checkClientQuotaMiddleware } from "../middleware/quotaCheck.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ✅ Apply authentication and company context to ALL routes
router.use(authenticateToken, attachCompanyContext);

// ============================================
// EXCEL IMPORT
// ============================================
router.post("/upload-excel", 
  blockTrialUserWrites,
  upload.single("file"),
  validateImportBatchSize,
  asyncHandler(clientsController.uploadExcel)
);

// ============================================
// CREATE CLIENT
// ============================================
router.post("/", 
  blockTrialUserWrites,
  checkClientQuotaMiddleware,
  asyncHandler(clientsController.createClient)
);

// ============================================
// GET CLIENTS
// ============================================
router.get("/", 
  enforceTrialUserLimits,
  asyncHandler(clientsController.getClients)
);

// ============================================
// UPDATE CLIENT ADDRESS
// ============================================
router.patch("/:id/address", 
  blockTrialUserWrites,
  asyncHandler(clientsController.updateClientAddress)
);

// ============================================
// GET SINGLE CLIENT
// ============================================
router.get("/:id", 
  enforceTrialUserLimits,
  asyncHandler(clientsController.getClientById)
);

// ============================================
// UPDATE CLIENT
// ============================================
router.put("/:id", 
  blockTrialUserWrites,
  asyncHandler(clientsController.updateClient)
);

// ============================================
// DELETE CLIENT
// ============================================
router.delete("/:id", 
  blockTrialUserWrites,
  asyncHandler(clientsController.deleteClient)
);

// ============================================
// ADVANCED SEARCH (Feature-Gated)
// ============================================
router.get("/search/advanced",
  requireFeature('advancedSearch'),
  enforceTrialUserLimits,
  asyncHandler(async (req, res) => {
    res.json({ 
      message: "Advanced search endpoint",
      filters: req.query 
    });
  })
);

// ============================================
// BULK OPERATIONS (Feature-Gated)
// ============================================
router.post("/bulk/update",
  requireFeature('bulkOperations'),
  blockTrialUserWrites,
  asyncHandler(async (req, res) => {
    res.json({ 
      message: "Bulk update endpoint",
      affectedClients: req.body.clientIds?.length || 0
    });
  })
);

router.post("/bulk/delete",
  requireFeature('bulkOperations'),
  blockTrialUserWrites,
  asyncHandler(async (req, res) => {
    res.json({ 
      message: "Bulk delete endpoint",
      affectedClients: req.body.clientIds?.length || 0
    });
  })
);

export default router;