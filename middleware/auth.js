import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { JWT_SECRET, MIDDLEWARE_TOKEN } from "../config/constants.js";

// ============================================
// JWT TOKEN AUTHENTICATION (for users)
// ============================================
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "AccessTokenRequired" });
  }

  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: "SESSION_INVALIDATED",
          message: "Your session has expired. Please login again." 
        });
      }
      return res.status(401).json({ 
        error: "SESSION_INVALIDATED",
        message: "Invalid token. Please login again."
      });
    }

    const result = await pool.query(
      `SELECT * FROM user_sessions WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      console.log(`🚫 Session not found or expired for token: ${token.substring(0, 20)}...`);
      return res.status(401).json({ 
        error: "SESSION_INVALIDATED",
        message: "Your session has been invalidated. Please login again."
      });
    }

    req.user = decoded;
    next();
  });
};

// ============================================
// MIDDLEWARE TOKEN AUTHENTICATION (for Tally middleware)
// ============================================
export const authenticateMiddleware = (req, res, next) => {
  console.log('\n🔐 Middleware Auth Check:');
  console.log('   Headers:', JSON.stringify(req.headers, null, 2));
  
  const token = req.headers['x-middleware-token'];
  
  if (!token) {
    console.log('❌ No x-middleware-token header found');
    return res.status(401).json({ 
      error: 'MiddlewareTokenRequired',
      message: 'x-middleware-token header is required' 
    });
  }

  const expectedToken = process.env.MIDDLEWARE_TOKEN || MIDDLEWARE_TOKEN;
  
  if (!expectedToken) {
    console.log('❌ MIDDLEWARE_TOKEN not configured in environment');
    return res.status(500).json({ 
      error: 'ServerError',
      message: 'Middleware authentication not configured' 
    });
  }

  console.log(`   Received token: ${token.substring(0, 20)}...`);
  console.log(`   Expected token: ${expectedToken.substring(0, 20)}...`);
  console.log(`   Match: ${token === expectedToken}`);

  if (token !== expectedToken) {
    console.log('❌ Token mismatch!');
    return res.status(401).json({ 
      error: 'InvalidMiddlewareToken',
      message: 'Invalid middleware token' 
    });
  }

  console.log('✅ Middleware token authenticated');
  next();
};

// ============================================
// OTHER MIDDLEWARE
// ============================================
export const requireName = async (req, res, next) => {
  const result = await pool.query(
    "SELECT full_name FROM profiles WHERE user_id = $1",
    [req.user.id]
  );

  if (result.rows.length === 0 || !result.rows[0].full_name || result.rows[0].full_name.trim().length === 0) {
    return res.status(403).json({ 
      error: "NameRequired",
      message: "Please add your name in profile settings to continue" 
    });
  }

  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: "AdminOnly" });
  }
  next();
};

export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userRole = req.user.isAdmin 
      ? 'admin' 
      : (req.user.role || 'user');
    
    console.log(`🔍 Auth Check: email=${req.user.email}, isAdmin=${req.user.isAdmin}, role=${req.user.role}, computed=${userRole}, required=${roles.join(',')}`);
    
    if (!roles.includes(userRole)) {
      return res.status(403).json({ 
        error: "Forbidden", 
        message: `This action requires one of these roles: ${roles.join(', ')}` 
      });
    }

    next();
  };
};