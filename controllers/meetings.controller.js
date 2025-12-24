// controllers/meetings.controller.js
// ✅ UPDATED: Update client status when ending meeting

import { pool } from "../db.js";

export const updateMeeting = async (req, res) => {
  const { id } = req.params;
  const { 
    endTime, 
    status, 
    comments, 
    attachments, 
    latitude, 
    longitude, 
    accuracy,
    clientStatus  // ✅ NEW: Client status to update (active/inactive/completed)
  } = req.body;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Verify meeting belongs to user
    const checkResult = await client.query(
      `SELECT client_id FROM meetings WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "MeetingNotFound" });
    }

    const clientId = checkResult.rows[0].client_id;

    // Update meeting
    const meetingResult = await client.query(
      `UPDATE meetings
       SET end_time = COALESCE($1, end_time, NOW()),
           end_latitude = COALESCE($2, end_latitude),
           end_longitude = COALESCE($3, end_longitude),
           end_accuracy = COALESCE($4, end_accuracy),
           status = COALESCE($5, status),
           comments = COALESCE($6, comments),
           attachments = COALESCE($7, attachments),
           updated_at = NOW()
       WHERE id = $8
       RETURNING 
         id,
         user_id as "userId",
         client_id as "clientId",
         start_time as "startTime",
         end_time as "endTime",
         start_latitude as "startLatitude",
         start_longitude as "startLongitude",
         start_accuracy as "startAccuracy",
         end_latitude as "endLatitude",
         end_longitude as "endLongitude",
         end_accuracy as "endAccuracy",
         status,
         comments,
         attachments,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        endTime || null,
        latitude || null,
        longitude || null,
        accuracy || null,
        status || 'COMPLETED',
        comments || null,
        attachments ? JSON.stringify(attachments) : null,
        id
      ]
    );

    // ✅ NEW: Update client status if provided
    if (clientStatus && ['active', 'inactive', 'completed'].includes(clientStatus.toLowerCase())) {
      await client.query(
        `UPDATE clients 
         SET status = $1, updated_at = NOW() 
         WHERE id = $2`,
        [clientStatus.toLowerCase(), clientId]
      );
      
      console.log(`✅ Client ${clientId} status updated to: ${clientStatus}`);
    }

    await client.query('COMMIT');

    console.log(`✅ Meeting ended: ${id} | Client status: ${clientStatus || 'unchanged'}`);

    res.json({
      message: "MeetingUpdated",
      meeting: meetingResult.rows[0],
      clientStatusUpdated: !!clientStatus
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating meeting:", error);
    res.status(500).json({ 
      error: "UpdateFailed", 
      message: error.message 
    });
  } finally {
    client.release();
  }
};

// Keep all other functions the same (startMeeting, getActiveMeeting, etc.)
export const startMeeting = async (req, res) => {
  const { clientId, latitude, longitude, accuracy } = req.body;

  if (!clientId) {
    return res.status(400).json({ error: "ClientIdRequired" });
  }

  const existingMeeting = await pool.query(
    `SELECT id FROM meetings 
     WHERE client_id = $1 
     AND user_id = $2 
     AND status = 'IN_PROGRESS'
     LIMIT 1`,
    [clientId, req.user.id]
  );

  if (existingMeeting.rows.length > 0) {
    return res.status(400).json({ 
      error: "ActiveMeetingExists",
      message: "You already have an active meeting with this client"
    });
  }

  const result = await pool.query(
    `INSERT INTO meetings 
     (user_id, client_id, start_time, start_latitude, start_longitude, start_accuracy, status)
     VALUES ($1, $2, NOW(), $3, $4, $5, 'IN_PROGRESS')
     RETURNING 
       id,
       user_id as "userId",
       client_id as "clientId",
       start_time as "startTime",
       end_time as "endTime",
       start_latitude as "startLatitude",
       start_longitude as "startLongitude",
       start_accuracy as "startAccuracy",
       end_latitude as "endLatitude",
       end_longitude as "endLongitude",
       end_accuracy as "endAccuracy",
       status,
       comments,
       attachments,
       created_at as "createdAt",
       updated_at as "updatedAt"`,
    [req.user.id, clientId, latitude || null, longitude || null, accuracy || null]
  );

  console.log(`✅ Meeting started: ${result.rows[0].id} for client ${clientId}`);

  res.status(201).json({
    message: "MeetingStarted",
    meeting: result.rows[0]
  });
};

export const getActiveMeeting = async (req, res) => {
  const { clientId } = req.params;

  const result = await pool.query(
    `SELECT 
       id,
       user_id as "userId",
       client_id as "clientId",
       start_time as "startTime",
       end_time as "endTime",
       start_latitude as "startLatitude",
       start_longitude as "startLongitude",
       start_accuracy as "startAccuracy",
       end_latitude as "endLatitude",
       end_longitude as "endLongitude",
       end_accuracy as "endAccuracy",
       status,
       comments,
       attachments,
       created_at as "createdAt",
       updated_at as "updatedAt"
     FROM meetings
     WHERE client_id = $1 
     AND user_id = $2 
     AND status = 'IN_PROGRESS'
     ORDER BY start_time DESC
     LIMIT 1`,
    [clientId, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.json({ meeting: null });
  }

  res.json({ meeting: result.rows[0] });
};

export const uploadAttachment = async (req, res) => {
  const { id } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: "NoFileUploaded" });
  }

  const checkResult = await pool.query(
    `SELECT id FROM meetings WHERE id = $1 AND user_id = $2`,
    [id, req.user.id]
  );

  if (checkResult.rows.length === 0) {
    return res.status(404).json({ error: "MeetingNotFound" });
  }

  const fileName = `${Date.now()}-${req.file.originalname}`;
  const fileUrl = `https://storage.yourdomain.com/meetings/${fileName}`;

  console.log(`📎 Meeting attachment uploaded: ${fileName} (${req.file.size} bytes)`);

  const currentResult = await pool.query(
    `SELECT attachments FROM meetings WHERE id = $1`,
    [id]
  );

  const currentAttachments = currentResult.rows[0]?.attachments || [];
  const updatedAttachments = [...currentAttachments, fileUrl];

  await pool.query(
    `UPDATE meetings 
     SET attachments = $1, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(updatedAttachments), id]
  );

  res.json({
    message: "AttachmentUploaded",
    url: fileUrl,
    fileName: fileName
  });
};

export const getMeetings = async (req, res) => {
  const { clientId, status, startDate, endDate, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT 
      m.id,
      m.user_id as "userId",
      m.client_id as "clientId",
      m.start_time as "startTime",
      m.end_time as "endTime",
      m.start_latitude as "startLatitude",
      m.start_longitude as "startLongitude",
      m.start_accuracy as "startAccuracy",
      m.end_latitude as "endLatitude",
      m.end_longitude as "endLongitude",
      m.end_accuracy as "endAccuracy",
      m.status,
      m.comments,
      m.attachments,
      m.created_at as "createdAt",
      m.updated_at as "updatedAt",
      c.name as "clientName",
      c.address as "clientAddress"
    FROM meetings m
    LEFT JOIN clients c ON m.client_id = c.id
    WHERE m.user_id = $1
  `;
  const params = [req.user.id];
  let paramCount = 1;

  if (clientId) {
    paramCount++;
    query += ` AND m.client_id = $${paramCount}`;
    params.push(clientId);
  }

  if (status) {
    paramCount++;
    query += ` AND m.status = $${paramCount}`;
    params.push(status);
  }

  if (startDate) {
    paramCount++;
    query += ` AND m.start_time >= $${paramCount}`;
    params.push(startDate);
  }

  if (endDate) {
    paramCount++;
    query += ` AND m.start_time <= $${paramCount}`;
    params.push(endDate);
  }

  query += ` ORDER BY m.start_time DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  let countQuery = "SELECT COUNT(*) FROM meetings WHERE user_id = $1";
  const countParams = [req.user.id];
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].count);

  res.json({
    meetings: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: total,
      totalPages: Math.ceil(total / limit)
    }
  });
};

export const getMeetingById = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT 
       m.id,
       m.user_id as "userId",
       m.client_id as "clientId",
       m.start_time as "startTime",
       m.end_time as "endTime",
       m.start_latitude as "startLatitude",
       m.start_longitude as "startLongitude",
       m.start_accuracy as "startAccuracy",
       m.end_latitude as "endLatitude",
       m.end_longitude as "endLongitude",
       m.end_accuracy as "endAccuracy",
       m.status,
       m.comments,
       m.attachments,
       m.created_at as "createdAt",
       m.updated_at as "updatedAt",
       c.name as "clientName",
       c.email as "clientEmail",
       c.phone as "clientPhone",
       c.address as "clientAddress"
     FROM meetings m
     LEFT JOIN clients c ON m.client_id = c.id
     WHERE m.id = $1 AND m.user_id = $2`,
    [id, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "MeetingNotFound" });
  }

  res.json({ meeting: result.rows[0] });
};

export const deleteMeeting = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `DELETE FROM meetings 
     WHERE id = $1 AND user_id = $2 
     RETURNING id`,
    [id, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "MeetingNotFound" });
  }

  console.log(`🗑️ Meeting deleted: ${id}`);

  res.json({ message: "MeetingDeleted" });
};