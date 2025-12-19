import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import * as expensesController from "../controllers/expenses.controller.js";

const router = express.Router();

router.post("/", authenticateToken, asyncHandler(expensesController.createExpense));
router.get("/my-total", authenticateToken, asyncHandler(expensesController.getMyTotal));
router.get("/my-expenses", authenticateToken, asyncHandler(expensesController.getMyExpenses));
router.post("/receipts", authenticateToken, asyncHandler(expensesController.uploadReceipt));
router.get("/:id", authenticateToken, asyncHandler(expensesController.getExpenseById));
router.put("/:id", authenticateToken, asyncHandler(expensesController.updateExpense));
router.delete("/:id", authenticateToken, asyncHandler(expensesController.deleteExpense));

export default router;