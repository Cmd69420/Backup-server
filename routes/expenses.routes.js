// routes/expenses.routes.js
// UPDATED: Added plan-based expense receipt limitations

import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { checkExpenseReceiptUpload } from "../middleware/featureAuth.js";  // ← NEW IMPORT
import * as expensesController from "../controllers/expenses.controller.js";
import multer from "multer";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// EXPENSE CRUD
// ============================================
router.post("/", 
  authenticateToken, 
  asyncHandler(expensesController.createExpense)
);

router.get("/my-total", 
  authenticateToken, 
  asyncHandler(expensesController.getMyTotal)
);

router.get("/my-expenses", 
  authenticateToken, 
  asyncHandler(expensesController.getMyExpenses)
);

router.get("/:id", 
  authenticateToken, 
  asyncHandler(expensesController.getExpenseById)
);

router.put("/:id", 
  authenticateToken, 
  asyncHandler(expensesController.updateExpense)
);

router.delete("/:id", 
  authenticateToken, 
  asyncHandler(expensesController.deleteExpense)
);

// ============================================
// RECEIPT UPLOAD (With Limits)
// ============================================
// Starter: 2 receipt images per expense, 5MB each
// Professional: 5 receipt images per expense, 10MB each
// Business: 10 receipt images per expense, 20MB each
// Enterprise: 20 receipt images per expense, 50MB each
router.post("/receipts", 
  authenticateToken,
  upload.single("file"),
  checkExpenseReceiptUpload,  // ← NEW: Checks receipt count & file size
  asyncHandler(expensesController.uploadReceipt)
);

export default router;