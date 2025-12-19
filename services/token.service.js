import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db.js";
import { JWT_SECRET } from "../config/constants.js";

/**
 * Generate JWT token for a user
 */
export const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin || false
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

/**
 * Verify JWT token
 */
export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error("InvalidToken");
  }
};

/**
 * Create a session for a user
 */
export const createSession = async (userId, token) => {
  await pool.query(
    `INSERT INTO user_sessions (user_id, token, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [userId, token]
  );
};

/**
 * Delete a session (logout)
 */
export const deleteSession = async (token) => {
  await pool.query(
    `DELETE FROM user_sessions WHERE token = $1`,
    [token]
  );
};

/**
 * Validate if session exists and is not expired
 */
export const validateSession = async (token) => {
  const result = await pool.query(
    `SELECT * FROM user_sessions 
     WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  return result.rows.length > 0;
};

/**
 * Generate password reset token
 */
export const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Save password reset token to database
 */
export const saveResetToken = async (email, resetToken) => {
  const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

  await pool.query(
    `UPDATE users 
     SET reset_token = $1, reset_token_expiry = $2 
     WHERE email = $3`,
    [resetToken, resetTokenExpiry, email]
  );
};

/**
 * Validate reset token
 */
export const validateResetToken = async (token) => {
  const result = await pool.query(
    `SELECT id FROM users 
     WHERE reset_token = $1 AND reset_token_expiry > NOW()`,
    [token]
  );

  if (result.rows.length === 0) {
    throw new Error("InvalidOrExpiredToken");
  }

  return result.rows[0].id;
};

/**
 * Clear reset token after password reset
 */
export const clearResetToken = async (userId) => {
  await pool.query(
    `UPDATE users 
     SET reset_token = NULL, reset_token_expiry = NULL 
     WHERE id = $1`,
    [userId]
  );
};

/**
 * Extract token from authorization header
 */
export const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) return null;
  
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }
  
  return parts[1];
};

/**
 * Clean up expired sessions (can be run as a cron job)
 */
export const cleanupExpiredSessions = async () => {
  const result = await pool.query(
    `DELETE FROM user_sessions WHERE expires_at < NOW() RETURNING id`
  );
  
  console.log(`🧹 Cleaned up ${result.rows.length} expired sessions`);
  return result.rows.length;
};