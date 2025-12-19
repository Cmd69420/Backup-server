import { pool } from "../db.js";

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