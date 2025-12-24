import { pool } from "../db.js";
import bcrypt from "bcryptjs";

export const getAllClients = async (req, res) => {
  const { status, search, page = 1, limit = 1000 } = req.query;
  const offset = (page - 1) * limit;

  let query = "SELECT * FROM clients WHERE 1=1";
  const params = [];
  let paramCount = 0;

  if (status) {
    paramCount++;
    query += ` AND status = $${paramCount}`;
    params.push(status);
  }

  if (search) {
    paramCount++;
    query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(parseInt(limit), parseInt(offset));

  const result = await pool.query(query, params);
  
  // Build count query with same filters
  let countQuery = "SELECT COUNT(*) FROM clients WHERE 1=1";
  const countParams = [];
  let countParamCount = 0;

  if (status) {
    countParamCount++;
    countQuery += ` AND status = $${countParamCount}`;
    countParams.push(status);
  }

  if (search) {
    countParamCount++;
    countQuery += ` AND (name ILIKE $${countParamCount} OR email ILIKE $${countParamCount})`;
    countParams.push(`%${search}%`);
  }

  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].count);

  console.log(`✅ Admin fetched ${result.rows.length} clients`);

  res.json({
    clients: result.rows,
    pagination: { 
      page: parseInt(page), 
      limit: parseInt(limit), 
      total, 
      totalPages: Math.ceil(total / limit) 
    }
  });
};

export const getAllUsers = async (req, res) => {
  const { limit = 1000 } = req.query;
  
  const result = await pool.query(
    `SELECT u.id, u.email, u.created_at, u.pincode,
            p.full_name, p.department, p.work_hours_start, p.work_hours_end
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     ORDER BY u.created_at DESC
     LIMIT $1`,
    [limit]
  );

  console.log(`✅ Admin fetched ${result.rows.length} users`);

  res.json({ users: result.rows });
};

export const getAnalytics = async (req, res) => {
  const clientStats = await pool.query(`
    SELECT 
      COUNT(*) as total_clients,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active_clients,
      COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as clients_with_location,
      COUNT(DISTINCT pincode) FILTER (WHERE pincode IS NOT NULL) as unique_pincodes
    FROM clients
  `);

  const userStats = await pool.query(`SELECT COUNT(*) as total_users FROM users`);
  const locationStats = await pool.query(`SELECT COUNT(*) as total_logs FROM location_logs`);

  console.log("✅ Admin analytics fetched successfully");

  res.json({
    clients: clientStats.rows[0],
    users: userStats.rows[0],
    locations: locationStats.rows[0]
  });
};

export const getUserLocationLogs = async (req, res) => {
  const { page = 1, limit = 200 } = req.query;
  const offset = (page - 1) * limit;
  const userId = req.params.userId;

  const result = await pool.query(
    `SELECT id, latitude, longitude, accuracy, activity, battery, notes, pincode, timestamp
     FROM location_logs
     WHERE user_id = $1
     ORDER BY timestamp DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const countResult = await pool.query(
    "SELECT COUNT(*) FROM location_logs WHERE user_id = $1",
    [userId]
  );

  console.log(`✅ Fetched ${result.rows.length} logs for user ${userId}`);

  res.json({
    logs: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(countResult.rows[0].count / limit),
    }
  });
};

export const getClockStatus = async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(`
    SELECT timestamp
    FROM location_logs
    WHERE user_id = $1
    ORDER BY timestamp DESC
    LIMIT 1
  `, [userId]);

  if (result.rows.length === 0) {
    return res.json({ clocked_in: false, last_seen: null });
  }

  const lastSeen = new Date(result.rows[0].timestamp);
  const now = new Date();
  const diffMinutes = (now - lastSeen) / (1000 * 60);
  
  // Consider active if logged location within last 5 minutes
  const isActive = diffMinutes <= 5;

  res.json({
    clocked_in: isActive,
    last_seen: lastSeen.toISOString()
  });
};

export const getExpensesSummary = async (req, res) => {
  const result = await pool.query(`
    SELECT 
      u.id,
      COALESCE(SUM(e.amount_spent), 0) AS total_expense
    FROM users u
    LEFT JOIN trip_expenses e ON e.user_id = u.id
    GROUP BY u.id
    ORDER BY u.id
  `);

  console.log(`✅ Fetched expense summary for ${result.rows.length} users`);

  res.json({ summary: result.rows });
};

export const getUserMeetings = async (req, res) => {
  const userId = req.params.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const totalCountResult = await pool.query(
    `SELECT COUNT(*) FROM meetings WHERE user_id = $1`,
    [userId]
  );
  const totalCount = parseInt(totalCountResult.rows[0].count);

  const result = await pool.query(
    `SELECT 
       m.id,
       m.user_id AS "userId",
       m.client_id AS "clientId",
       m.start_time AS "startTime",
       m.end_time AS "endTime",
       m.start_latitude AS "startLatitude",
       m.start_longitude AS "startLongitude",
       m.start_accuracy AS "startAccuracy",
       m.end_latitude AS "endLatitude",
       m.end_longitude AS "endLongitude",
       m.end_accuracy AS "endAccuracy",
       m.status,
       m.comments,
       m.attachments,
       m.created_at AS "createdAt",
       m.updated_at AS "updatedAt",
       c.name AS "clientName",
       c.address AS "clientAddress"
     FROM meetings m
     LEFT JOIN clients c ON m.client_id = c.id
     WHERE m.user_id = $1
     ORDER BY m.start_time DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  console.log(`Fetched ${result.rows.length} meetings for user ${userId}`);

  res.json({
    meetings: result.rows,
    pagination: {
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  });
};

export const getUserExpenses = async (req, res) => {
  const userId = req.params.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const totalResult = await pool.query(
    `SELECT COUNT(*) FROM trip_expenses WHERE user_id = $1`,
    [userId]
  );
  const total = parseInt(totalResult.rows[0].count);

  const logsResult = await pool.query(
    `SELECT 
       id,
       user_id AS "userId",
       start_location AS "startLocation",
       end_location AS "endLocation",
       travel_date AS "travelDate",
       distance_km AS "distanceKm",
       transport_mode AS "transportMode",
       amount_spent AS "amountSpent",
       currency,
       notes,
       receipt_urls AS "receiptUrls",
       client_id AS "clientId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM trip_expenses
     WHERE user_id = $1
     ORDER BY travel_date DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  res.json({
    expenses: logsResult.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

export const checkAdminStatus = (req, res) => {
  res.json({ 
    isAdmin: req.user.isAdmin || false,
    userId: req.user.id,
    email: req.user.email
  });
};

// Add these functions to your existing admin.controller.js

// Get single user details
export const getUserDetails = async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(
    `SELECT u.id, u.email, u.is_admin, u.created_at, u.pincode,
            p.full_name, p.department, p.work_hours_start, p.work_hours_end
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     WHERE u.id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  console.log(`✅ Admin fetched user details: ${userId}`);
  res.json({ user: result.rows[0] });
};

// Create user (admin version)
export const createUser = async (req, res) => {
  const { email, password, fullName, department, workHoursStart, workHoursEnd, isAdmin = false } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: "MissingFields" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "PasswordTooShort" });
  }

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "EmailAlreadyExists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  const userResult = await pool.query(
    `INSERT INTO users (email, password, is_admin)
     VALUES ($1, $2, $3)
     RETURNING id, email, is_admin, created_at`,
    [email, hashedPassword, isAdmin]
  );

  const user = userResult.rows[0];
  
  await pool.query(
    `INSERT INTO profiles (user_id, full_name, department, work_hours_start, work_hours_end)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, fullName || null, department || null, workHoursStart || null, workHoursEnd || null]
  );

  console.log(`✅ Admin created user: ${email} (Admin: ${isAdmin})`);
  res.status(201).json({ 
    message: "UserCreated", 
    user: {
      ...user,
      full_name: fullName,
      department
    }
  });
};

// Update user (admin version)
export const updateUser = async (req, res) => {
  const { userId } = req.params;
  const { email, fullName, department, workHoursStart, workHoursEnd, isAdmin } = req.body;

  // Check if user exists
  const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  // Update users table (email and is_admin)
  if (email !== undefined || isAdmin !== undefined) {
    let query = "UPDATE users SET";
    const params = [];
    let paramCount = 0;

    if (email !== undefined) {
      // Check if email is already taken by another user
      const emailCheck = await pool.query(
        "SELECT id FROM users WHERE email = $1 AND id != $2",
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ error: "EmailAlreadyExists" });
      }

      paramCount++;
      query += ` email = $${paramCount}`;
      params.push(email);
    }

    if (isAdmin !== undefined) {
      if (paramCount > 0) query += ",";
      paramCount++;
      query += ` is_admin = $${paramCount}`;
      params.push(isAdmin);
    }

    paramCount++;
    query += ` WHERE id = $${paramCount} RETURNING id, email, is_admin`;
    params.push(userId);

    await pool.query(query, params);
  }

  // Update profiles table
  const profileResult = await pool.query(
    `UPDATE profiles 
     SET full_name = COALESCE($1, full_name),
         department = COALESCE($2, department),
         work_hours_start = COALESCE($3, work_hours_start),
         work_hours_end = COALESCE($4, work_hours_end)
     WHERE user_id = $5
     RETURNING *`,
    [fullName, department, workHoursStart, workHoursEnd, userId]
  );

  console.log(`✅ Admin updated user: ${userId}`);
  res.json({ 
    message: "UserUpdated", 
    user: {
      id: userId,
      email: email,
      ...profileResult.rows[0]
    }
  });
};

// Delete user (hard delete)
export const deleteUser = async (req, res) => {
  const { userId } = req.params;

  // Check if user exists
  const userCheck = await pool.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  // Prevent self-deletion
  if (userId === req.user.id) {
    return res.status(400).json({ error: "CannotDeleteSelf" });
  }

  const userEmail = userCheck.rows[0].email;

  // Hard delete - remove user and related data
  // Delete in order to respect foreign key constraints
  await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM location_logs WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM meetings WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM trip_expenses WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM profiles WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);

  console.log(`🗑️ Admin deleted user: ${userEmail} (${userId})`);
  res.json({ message: "UserDeleted", email: userEmail });
};

// Reset user password (admin function)
export const resetUserPassword = async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "PasswordTooShort" });
  }

  // Check if user exists
  const userCheck = await pool.query("SELECT id, email FROM users WHERE id = $1", [userId]);
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await pool.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, userId]
  );

  // Invalidate all sessions for this user
  await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);

  console.log(`🔑 Admin reset password for user: ${userCheck.rows[0].email}`);
  res.json({ message: "PasswordReset", email: userCheck.rows[0].email });
};