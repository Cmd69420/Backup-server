import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import * as tokenService from "../services/token.service.js";

export const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "MissingFields" });
  }

  const result = await pool.query(
    `SELECT u.*, p.full_name, p.department, p.work_hours_start, p.work_hours_end
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     WHERE u.email = $1`,
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: "InvalidCredentials" });
  }

  const user = result.rows[0];
  const validPassword = await bcrypt.compare(password, user.password);
  
  if (!validPassword) {
    return res.status(401).json({ error: "InvalidCredentials" });
  }

  const token = tokenService.generateToken({
    id: user.id,
    email: user.email,
    isAdmin: user.is_admin
  });

  await tokenService.createSession(user.id, token);

  res.json({
    message: "LoginSuccess",
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      department: user.department,
      workHoursStart: user.work_hours_start,
      workHoursEnd: user.work_hours_end,
    },
  });
};

export const logout = async (req, res) => {
  const token = tokenService.extractTokenFromHeader(req.headers["authorization"]);
  await tokenService.deleteSession(token);
  res.json({ message: "LogoutSuccess" });
};

export const signup = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "MissingFields" });
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "EmailAlreadyExists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const userResult = await pool.query(
    `INSERT INTO users (email, password, is_admin)
     VALUES ($1, $2, false)
     RETURNING id, email`,
    [email, hashedPassword]
  );

  const user = userResult.rows[0];
  await pool.query(`INSERT INTO profiles (user_id) VALUES ($1)`, [user.id]);

  const token = tokenService.generateToken({
    id: user.id,
    email: user.email,
    isAdmin: false
  });

  await tokenService.createSession(user.id, token);

  res.status(201).json({
    message: "SignupSuccess",
    token,
    user,
  });
};

export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "EmailRequired" });
  }

  const result = await pool.query("SELECT id FROM users WHERE email = $1", [email]);

  if (result.rows.length === 0) {
    return res.json({ message: "PasswordResetEmailSent" });
  }

  const resetToken = tokenService.generateResetToken();
  await tokenService.saveResetToken(email, resetToken);

  console.log("🔑 Password Reset Token:", resetToken);
  console.log("📧 For Email:", email);

  res.json({
    message: "PasswordResetEmailSent",
    resetToken: resetToken,
  });
};

export const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: "MissingFields" });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "PasswordTooShort" });
  }

  const userId = await tokenService.validateResetToken(token);
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await pool.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, userId]
  );

  await tokenService.clearResetToken(userId);

  res.json({ message: "PasswordResetSuccess" });
};

export const getProfile = async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, p.full_name, p.department, p.work_hours_start, p.work_hours_end, p.created_at
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     WHERE u.id = $1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  res.json({ user: result.rows[0] });
};

export const updateProfile = async (req, res) => {
  const { fullName, department, workHoursStart, workHoursEnd } = req.body;

  const result = await pool.query(
    `UPDATE profiles 
     SET full_name = $1, department = $2, work_hours_start = $3, work_hours_end = $4
     WHERE user_id = $5
     RETURNING *`,
    [fullName, department, workHoursStart, workHoursEnd, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ProfileNotFound" });
  }

  res.json({
    message: "ProfileUpdated",
    profile: result.rows[0],
  });
};

export const clearPincode = async (req, res) => {
  await pool.query(
    `UPDATE users SET pincode = NULL WHERE id = $1`,
    [req.user.id]
  );
  console.log(`🛑 Tracking stopped → cleared pincode for ${req.user.id}`);
  res.json({ message: "PincodeCleared" });
};

export const verifyToken = (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      isAdmin: req.user.isAdmin || false
    }
  });
};
