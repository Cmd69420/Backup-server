import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { CORS_ORIGIN, PORT } from "./config/constants.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { startBackgroundGeocode } from "./utils/geocodeBatch.js";

// Route imports
import authRoutes from "./routes/auth.routes.js";
import clientRoutes from "./routes/clients.routes.js";
import locationRoutes from "./routes/location.routes.js";
import meetingRoutes from "./routes/meetings.routes.js";
import expenseRoutes from "./routes/expenses.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import syncRoutes from "./routes/sync.routes.js";

const app = express();

// Middleware
app.use(cors({
  origin: CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());
app.use(express.json());

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

// Routes
app.use("/auth", authRoutes);
app.use("/clients", clientRoutes);
app.use("/location-logs", locationRoutes);
app.use("/meetings", meetingRoutes);
app.use("/expenses", expenseRoutes);
app.use("/admin", adminRoutes);
app.use("/api/sync", syncRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "Client Tracking API with Pincode Filtering" });
});

app.get("/dbtest", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ db_time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📍 Pincode-based filtering enabled`);
});