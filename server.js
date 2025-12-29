// server.js
// UPDATED: Added company context middleware and routes

import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { CORS_ORIGIN, PORT } from "./config/constants.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authenticateToken } from "./middleware/auth.js";
import { attachCompanyContext } from "./middleware/company.js";
import { startBackgroundGeocode } from "./utils/geocodeBatch.js";

// Route imports
import authRoutes from "./routes/auth.routes.js";
import clientRoutes from "./routes/clients.routes.js";
import locationRoutes from "./routes/location.routes.js";
import meetingRoutes from "./routes/meetings.routes.js";
import expenseRoutes from "./routes/expenses.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import syncRoutes from "./routes/sync.routes.js";
import servicesRoutes from './routes/services.routes.js';
import manualClientRoutes from './routes/manualClient.routes.js';
import companyRoutes from './routes/company.routes.js'; // ← NEW

const app = express();

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-company-id"] // ← Added x-company-id
}));
app.options("*", cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// Test DB connection
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
  } else {
    console.log("✅ Database connected successfully");
  }
});

// ============================================
// PUBLIC ROUTES (No Authentication)
// ============================================
app.use("/auth", authRoutes);

// ============================================
// COMPANY-SCOPED ROUTES (Authenticated + Company Context)
// ============================================
// These routes require both authentication AND company context
app.use("/clients", authenticateToken, attachCompanyContext, clientRoutes);
app.use("/location-logs", authenticateToken, attachCompanyContext, locationRoutes);
app.use("/meetings", authenticateToken, attachCompanyContext, meetingRoutes);
app.use("/expenses", authenticateToken, attachCompanyContext, expenseRoutes);
app.use('/services', authenticateToken, attachCompanyContext, servicesRoutes);
app.use('/api/manual-clients', authenticateToken, attachCompanyContext, manualClientRoutes);

// ============================================
// ADMIN ROUTES (Company Admin)
// ============================================
// Admin routes operate within their company scope
app.use("/admin", authenticateToken, attachCompanyContext, adminRoutes);

// ============================================
// SUPER ADMIN ROUTES (Cross-Company Management)
// ============================================
// Super admin routes for managing all companies
app.use("/super-admin/companies", companyRoutes);

// ============================================
// SYNC ROUTES (Middleware + Authenticated)
// ============================================
app.use("/api/sync", syncRoutes);

// ============================================
// HEALTH CHECK
// ============================================
app.get("/", (req, res) => {
  res.json({ 
    message: "Multi-Company Client Tracking API",
    version: "2.0.0",
    features: ["company-scoped", "super-admin", "pincode-filtering"]
  });
});

app.get("/dbtest", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    const companyCount = await pool.query("SELECT COUNT(*) FROM companies");
    res.json({ 
      db_time: result.rows[0].now,
      companies: parseInt(companyCount.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🏢 Multi-company mode enabled`);
  console.log(`📍 Pincode-based filtering enabled`);
  console.log(`📦 Request body limit: 10mb`);
});