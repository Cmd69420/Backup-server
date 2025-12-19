import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { JWT_SECRET, MIDDLEWARE_TOKEN } from "../config/constants.js";

export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "AccessTokenRequired" });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ error: "InvalidToken" });

    const result = await pool.query(
      `SELECT * FROM user_sessions WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "SessionExpired" });
    }

    req.user = decoded;
    next();
  });
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "AdminOnly" });
  }
  next();
};

export const authenticateMiddleware = (req, res, next) => {
  const token = req.headers["x-middleware-token"];

  if (!token) {
    return res.status(401).json({ error: "MiddlewareTokenRequired" });
  }

  if (token !== MIDDLEWARE_TOKEN) {
    return res.status(403).json({ error: "InvalidMiddlewareToken" });
  }

  next();
};