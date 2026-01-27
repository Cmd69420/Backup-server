// controllers/admin.controller.js - COMPLETE UPDATE
// Added quota tracking to user operations

import { pool } from "../db.js";
import bcrypt from "bcryptjs";
import { incrementUserCount, decrementUserCount } from "../services/usage-tracker.js";

export const getAllClients = async (req, res) => {
  const { status, search, page = 1, limit = 1000 } = req.query;
  const offset = (page - 1) * limit;

  let query = "SELECT * FROM clients WHERE 1=1";
  const params = [];
  let paramCount = 0;

  if (!req.isSuperAdmin) {
    paramCount++;
    query += ` AND company_id = $${paramCount}`;
    params.push(req.companyId);
  }

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
  
  let countQuery = "SELECT COUNT(*) FROM clients WHERE 1=1";
  const countParams = [];
  let countParamCount = 0;

  if (!req.isSuperAdmin) {
    countParamCount++;
    countQuery += ` AND company_id = $${countParamCount}`;
    countParams.push(req.companyId);
  }

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
  
  let query = `
    SELECT u.id, u.email, u.created_at, u.pincode, u.is_admin, u.is_super_admin,
           p.full_name, p.department, p.work_hours_start, p.work_hours_end
    FROM users u
    LEFT JOIN profiles p ON u.id = p.user_id
  `;
  const params = [];
  
  if (!req.isSuperAdmin) {
    query += ` WHERE u.company_id = $1`;
    params.push(req.companyId);
  }
  
  query += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  
  const result = await pool.query(query, params);

  console.log(`✅ Admin fetched ${result.rows.length} users`);

  res.json({ users: result.rows });
};

export const getAnalytics = async (req, res) => {
  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $1';
  const params = req.isSuperAdmin ? [] : [req.companyId];

  const clientStats = await pool.query(`
    SELECT 
      COUNT(*) as total_clients,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active_clients,
      COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as clients_with_location,
      COUNT(DISTINCT pincode) FILTER (WHERE pincode IS NOT NULL) as unique_pincodes
    FROM clients
    WHERE 1=1 ${companyFilter}
  `, params);

  const userStats = await pool.query(`
    SELECT COUNT(*) as total_users 
    FROM users 
    WHERE 1=1 ${companyFilter}
  `, params);

  const locationStats = await pool.query(`
    SELECT COUNT(*) as total_logs 
    FROM location_logs
    WHERE 1=1 ${companyFilter}
  `, params);

  const totalClients = parseInt(clientStats.rows[0].total_clients);
  const withCoords = parseInt(clientStats.rows[0].clients_with_location);
  const coveragePercent = totalClients > 0 ? ((withCoords / totalClients) * 100).toFixed(1) : 0;

  const trendsData = await pool.query(`
    SELECT 
      TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') as month,
      COUNT(*) as clients,
      COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
      COUNT(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 END) as "withLocation"
    FROM clients
    WHERE created_at >= NOW() - INTERVAL '6 months'
    ${companyFilter}
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY DATE_TRUNC('month', created_at)
  `, params);

  const topAreas = await pool.query(`
    SELECT 
      pincode as area,
      COUNT(*) as clients
    FROM clients
    WHERE pincode IS NOT NULL
    ${companyFilter}
    GROUP BY pincode
    ORDER BY clients DESC
    LIMIT 5
  `, params);

  const userLeaderboard = await pool.query(`
    SELECT
      u.id,
      COALESCE(p.full_name, u.email) AS name,
      COUNT(DISTINCT c.id) AS clients_created,
      COUNT(DISTINCT m.id) AS meetings_held
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN clients c ON c.created_by = u.id ${!req.isSuperAdmin ? 'AND c.company_id = $1' : ''}
    LEFT JOIN meetings m ON m.user_id = u.id ${!req.isSuperAdmin ? 'AND m.company_id = $1' : ''}
    WHERE u.is_admin = false
    ${!req.isSuperAdmin ? 'AND u.company_id = $1' : ''}
    GROUP BY u.id, p.full_name, u.email
    ORDER BY meetings_held DESC, clients_created DESC
    LIMIT 5
  `, params);

  const recentActivity = await pool.query(`
    SELECT
      (SELECT COUNT(*) 
       FROM meetings 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       ${companyFilter}) AS meetings_last_month,

      (SELECT COUNT(*) 
       FROM trip_expenses 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       ${companyFilter}) AS expenses_last_month,

      (SELECT COUNT(*) 
       FROM clients 
       WHERE created_at >= NOW() - INTERVAL '30 days'
       ${companyFilter}) AS new_clients_last_month
  `, params);

  const inactiveClients = await pool.query(`
    SELECT COUNT(*) as inactive_count
    FROM clients c
    WHERE c.status = 'active'
      ${companyFilter}
      AND NOT EXISTS (
        SELECT 1 FROM meetings m 
        WHERE m.client_id = c.id 
        AND m.created_at >= NOW() - INTERVAL '30 days'
      )
  `, params);

  console.log("✅ Admin analytics fetched successfully");

  res.json({
    stats: {
      totalClients: totalClients,
      activeClients: parseInt(clientStats.rows[0].active_clients),
      withCoordinates: withCoords,
      uniquePincodes: parseInt(clientStats.rows[0].unique_pincodes),
      totalUsers: parseInt(userStats.rows[0].total_users),
      totalLogs: parseInt(locationStats.rows[0].total_logs),
      coordinatesCoverage: parseFloat(coveragePercent),
      inactiveClients: parseInt(inactiveClients.rows[0].inactive_count),
      meetingsLastMonth: parseInt(recentActivity.rows[0].meetings_last_month || 0),
      expensesLastMonth: parseInt(recentActivity.rows[0].expenses_last_month || 0),
      newClientsLastMonth: parseInt(recentActivity.rows[0].new_clients_last_month || 0)
    },
    trends: trendsData.rows,
    distribution: topAreas.rows,
    leaderboard: userLeaderboard.rows
  });
};

export const getUserLocationLogs = async (req, res) => {
  try {
    const { page = 1, limit = 200 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.params.userId;

    // Build correct company filter
    let companyClause = "";
    let params = [userId];

    if (!req.isSuperAdmin) {
      companyClause = "AND company_id = $2";
      params.push(req.companyId);
    }

    // Fetch logs
    const logsResult = await pool.query(
      `
      SELECT id, latitude, longitude, accuracy, activity,
             battery, notes, pincode, timestamp
      FROM location_logs
      WHERE user_id = $1
      ${companyClause}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    // Count total logs
    const countResult = await pool.query(
      `
      SELECT COUNT(*)
      FROM location_logs
      WHERE user_id = $1
      ${companyClause}
      `,
      params
    );

    res.json({
      logs: logsResult.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        totalPages: Math.ceil(countResult.rows[0].count / limit),
      },
    });

  } catch (err) {
    console.error("❌ Location logs fetch failed:", err);
    res.status(500).json({
      error: "FailedToFetchLocationLogs",
      message: err.message,
    });
  }
};


export const getClockStatus = async (req, res) => {
  const { userId } = req.params;

  if (!req.isSuperAdmin) {
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND company_id = $2",
      [userId, req.companyId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "UserNotFound" });
    }
  }

  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $2';
  const params = [userId];
  if (!req.isSuperAdmin) {
    params.push(req.companyId);
  }

  const result = await pool.query(`
    SELECT timestamp
    FROM location_logs
    WHERE user_id = $1
    ${companyFilter}
    ORDER BY timestamp DESC
    LIMIT 1
  `, params);

  if (result.rows.length === 0) {
    return res.json({ clocked_in: false, last_seen: null });
  }

  const lastSeen = new Date(result.rows[0].timestamp);
  const now = new Date();
  const diffMinutes = (now - lastSeen) / (1000 * 60);
  
  const isActive = diffMinutes <= 5;

  res.json({
    clocked_in: isActive,
    last_seen: lastSeen.toISOString()
  });
};

export const getExpensesSummary = async (req, res) => {
  const companyFilter = req.isSuperAdmin ? '' : 'WHERE u.company_id = $1';
  const params = req.isSuperAdmin ? [] : [req.companyId];

  const result = await pool.query(`
    SELECT 
      u.id,
      COALESCE(SUM(e.amount_spent), 0) AS total_expense
    FROM users u
    LEFT JOIN trip_expenses e ON e.user_id = u.id ${!req.isSuperAdmin ? 'AND e.company_id = $1' : ''}
    ${companyFilter}
    GROUP BY u.id
    ORDER BY u.id
  `, params);

  console.log(`✅ Fetched expense summary for ${result.rows.length} users`);

  res.json({ summary: result.rows });
};

export const getUserMeetings = async (req, res) => {
  const userId = req.params.userId;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  if (!req.isSuperAdmin) {
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND company_id = $2",
      [userId, req.companyId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "UserNotFound" });
    }
  }

  const companyFilter = req.isSuperAdmin ? '' : 'AND m.company_id = $4';
  const params = [userId, limit, offset];
  if (!req.isSuperAdmin) {
    params.push(req.companyId);
  }

  const totalCountResult = await pool.query(
    `SELECT COUNT(*)
     FROM meetings m
     WHERE m.user_id = $1
     ${req.isSuperAdmin ? '' : 'AND m.company_id = $2'}`,
    req.isSuperAdmin ? [userId] : [userId, req.companyId]
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
     ${companyFilter}
     ORDER BY m.start_time DESC
     LIMIT $2 OFFSET $3`,
    params
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

  if (!req.isSuperAdmin) {
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND company_id = $2",
      [userId, req.companyId]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "UserNotFound" });
    }
  }

  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $2';

  const totalResult = await pool.query(
    `SELECT COUNT(*) FROM trip_expenses WHERE user_id = $1 ${companyFilter}`,
    req.isSuperAdmin ? [userId] : [userId, req.companyId]
  );
  const total = parseInt(totalResult.rows[0].count);

  const logsResult = await pool.query(
    `SELECT * FROM trip_expenses
     WHERE user_id = $1
     ${companyFilter}
     ORDER BY travel_date DESC
     LIMIT $${req.isSuperAdmin ? 2 : 3} OFFSET $${req.isSuperAdmin ? 3 : 4}`,
    req.isSuperAdmin ? [userId, limit, offset] : [userId, req.companyId, limit, offset]
  );

  const transformExpenseRow = (row) => ({
    id: row.id,
    userId: row.user_id,
    tripName: row.trip_name,
    isMultiLeg: row.is_multi_leg || false,
    startLocation: row.start_location,
    endLocation: row.end_location,
    travelDate: row.travel_date,
    distanceKm: row.distance_km,
    transportMode: row.transport_mode,
    amountSpent: row.amount_spent,
    currency: row.currency,
    notes: row.notes,
    receiptUrls: row.receipt_images || [],
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legs: []
  });

  const transformLegRow = (row) => ({
    id: row.id,
    expenseId: row.expense_id,
    legNumber: row.leg_number,
    startLocation: row.start_location,
    endLocation: row.end_location,
    distanceKm: row.distance_km,
    transportMode: row.transport_mode,
    amountSpent: row.amount_spent,
    notes: row.notes,
    createdAt: row.created_at
  });

  const expenses = logsResult.rows.map(transformExpenseRow);

  for (const expense of expenses) {
    if (expense.isMultiLeg) {
      const legsResult = await pool.query(
        `SELECT * FROM trip_legs WHERE expense_id = $1 ORDER BY leg_number`,
        [expense.id]
      );
      expense.legs = legsResult.rows.map(transformLegRow);
    }
  }

  res.json({
    expenses: expenses,
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
    isSuperAdmin: req.user.isSuperAdmin || false,
    userId: req.user.id,
    email: req.user.email,
    companyId: req.user.companyId
  });
};

export const getUserDetails = async (req, res) => {
  const { userId } = req.params;

  const companyFilter = req.isSuperAdmin ? '' : 'AND u.company_id = $2';
  const params = [userId];
  if (!req.isSuperAdmin) {
    params.push(req.companyId);
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.is_admin, u.is_super_admin, u.created_at, u.pincode, u.company_id,
            p.full_name, p.department, p.work_hours_start, p.work_hours_end,
            c.name as company_name, c.subdomain as company_subdomain
     FROM users u
     LEFT JOIN profiles p ON u.id = p.user_id
     LEFT JOIN companies c ON u.company_id = c.id
     WHERE u.id = $1 ${companyFilter}`,
    params
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  console.log(`✅ Admin fetched user details: ${userId}`);
  res.json({ user: result.rows[0] });
};

// ============================================
// ✅ UPDATED: CREATE USER WITH QUOTA TRACKING
// ============================================
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
  
  const targetCompanyId = req.body.companyId || req.companyId;
  
  if (targetCompanyId !== req.companyId && !req.isSuperAdmin) {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Only super admins can assign users to different companies" 
    });
  }

  if (isAdmin && !req.isSuperAdmin) {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Only super admins can create admin users" 
    });
  }

  // ============================================
  // ✅ ATOMIC TRANSACTION: Create + Increment
  // ============================================
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `INSERT INTO users (email, password, is_admin, company_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, is_admin, company_id, created_at`,
      [email, hashedPassword, isAdmin, targetCompanyId]
    );

    const user = userResult.rows[0];
    
    await client.query(
      `INSERT INTO profiles (user_id, full_name, department, work_hours_start, work_hours_end)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, fullName || null, department || null, workHoursStart || null, workHoursEnd || null]
    );

    // ✅ INCREMENT USER COUNT ATOMICALLY
    await incrementUserCount(targetCompanyId, client);

    await client.query('COMMIT');

    console.log(`✅ Admin created user: ${email} (Admin: ${isAdmin}) - Quota updated`);
    
    res.status(201).json({ 
      message: "UserCreated", 
      user: {
        ...user,
        full_name: fullName,
        department
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ User creation failed:', error);
    res.status(500).json({ error: "UserCreationFailed", message: error.message });
  } finally {
    client.release();
  }
};

export const updateUser = async (req, res) => {
  const { userId } = req.params;
  const { email, fullName, department, workHoursStart, workHoursEnd, isAdmin } = req.body;

  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $2';
  const checkParams = [userId];
  if (!req.isSuperAdmin) {
    checkParams.push(req.companyId);
  }

  const userCheck = await pool.query(
    `SELECT id FROM users WHERE id = $1 ${companyFilter}`,
    checkParams
  );

  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  if (isAdmin !== undefined && !req.isSuperAdmin) {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Only super admins can change admin status" 
    });
  }

  if (email !== undefined || isAdmin !== undefined) {
    let query = "UPDATE users SET";
    const params = [];
    let paramCount = 0;

    if (email !== undefined) {
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

// ============================================
// ✅ UPDATED: DELETE USER WITH QUOTA TRACKING
// ============================================
export const deleteUser = async (req, res) => {
  const { userId } = req.params;

  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $2';
  const checkParams = [userId];
  if (!req.isSuperAdmin) {
    checkParams.push(req.companyId);
  }

  const userCheck = await pool.query(
    `SELECT id, email, company_id FROM users WHERE id = $1 ${companyFilter}`,
    checkParams
  );

  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  if (userId === req.user.id) {
    return res.status(400).json({ error: "CannotDeleteSelf" });
  }

  const userEmail = userCheck.rows[0].email;
  const userCompanyId = userCheck.rows[0].company_id;

  // ============================================
  // ✅ ATOMIC TRANSACTION: Delete + Decrement
  // ============================================
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    await client.query("DELETE FROM users WHERE id = $1", [userId]);

    // ✅ DECREMENT USER COUNT ATOMICALLY
    await decrementUserCount(userCompanyId, client);

    await client.query('COMMIT');

    console.log(`🗑️ Admin deleted user: ${userEmail} (${userId}) - Quota updated`);
    
    res.json({ message: "UserDeleted", email: userEmail });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ User deletion failed:', error);
    res.status(500).json({ error: "UserDeletionFailed", message: error.message });
  } finally {
    client.release();
  }
};

export const resetUserPassword = async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "PasswordTooShort" });
  }

  const companyFilter = req.isSuperAdmin ? '' : 'AND company_id = $2';
  const checkParams = [userId];
  if (!req.isSuperAdmin) {
    checkParams.push(req.companyId);
  }

  const userCheck = await pool.query(
    `SELECT id, email FROM users WHERE id = $1 ${companyFilter}`,
    checkParams
  );

  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "UserNotFound" });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await pool.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, userId]
  );

  await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);

  console.log(`🔑 Admin reset password for user: ${userCheck.rows[0].email}`);
  res.json({ message: "PasswordReset", email: userCheck.rows[0].email });
};
