// controllers/services.controller.js - COMPLETE VERSION

import { pool } from "../db.js";

// ==========================================
// 1. Get services for ONE specific client
// Used by: ClientServicesModal.js
// ==========================================
export const getClientServices = async (req, res) => {
  const { clientId } = req.params;
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Check if client exists
    const clientCheck = await pool.query(
      'SELECT id FROM clients WHERE id = $1',
      [clientId]
    );

    if (clientCheck.rows.length === 0) {
      return res.json({
        services: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 }
      });
    }

    // Build query
    let query = `
      SELECT 
        cs.*,
        u1.email as "createdByEmail",
        u2.email as "updatedByEmail",
        c.name as "clientName"
      FROM client_services cs
      LEFT JOIN users u1 ON cs.created_by = u1.id
      LEFT JOIN users u2 ON cs.updated_by = u2.id
      LEFT JOIN clients c ON cs.client_id = c.id
      WHERE cs.client_id = $1
    `;
    const params = [clientId];
    let paramCount = 1;

    if (status) {
      paramCount++;
      query += ` AND cs.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY cs.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    const countQuery = `SELECT COUNT(*) FROM client_services WHERE client_id = $1`;
    const countResult = await pool.query(countQuery, [clientId]);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      services: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching client services:", error);
    res.json({
      services: [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: 0,
        totalPages: 0
      }
    });
  }
};

// ==========================================
// 2. Get ALL services across ALL clients
// Used by: ClientServicesPage.js
// ==========================================
export const getAllServices = async (req, res) => {
  const { status, page = 1, limit = 5000 } = req.query;
  const offset = (page - 1) * limit;

  try {
    // ONE database query to get ALL services with client info
    let query = `
      SELECT 
        cs.id,
        cs.service_name,
        cs.description,
        cs.status,
        cs.start_date,
        cs.expiry_date,
        cs.price,
        cs.notes,
        cs.created_at,
        cs.updated_at,
        cs.client_id,
        c.name as "clientName",
        c.email as "clientEmail",
        c.phone as "clientPhone",
        u1.email as "createdByEmail"
      FROM client_services cs
      LEFT JOIN clients c ON cs.client_id = c.id
      LEFT JOIN users u1 ON cs.created_by = u1.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Optional status filter
    if (status) {
      paramCount++;
      query += ` AND cs.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY cs.expiry_date ASC NULLS LAST LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM client_services cs WHERE 1=1`;
    if (status) {
      countQuery += ` AND cs.status = $1`;
    }
    const countResult = await pool.query(countQuery, status ? [status] : []);
    const total = parseInt(countResult.rows[0].count);

    console.log(`✅ Fetched ${result.rows.length} services (Total: ${total})`);

    res.json({
      services: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching all services:", error);
    res.status(500).json({ 
      error: "Failed to fetch services", 
      message: error.message 
    });
  }
};

// ==========================================
// 3. Create new service
// ==========================================
export const createService = async (req, res) => {
  const { clientId } = req.params;
  const {
    serviceName,
    description,
    startDate,
    expiryDate,
    price,
    notes,
    status = 'active'
  } = req.body;

  if (!serviceName) {
    return res.status(400).json({ error: "Service name is required" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if client exists
    const clientCheck = await client.query(
      'SELECT id FROM clients WHERE id = $1',
      [clientId]
    );

    if (clientCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Client not found" });
    }

    // Create service
    const result = await client.query(
      `INSERT INTO client_services 
       (client_id, service_name, description, status, start_date, expiry_date, price, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        clientId,
        serviceName,
        description || null,
        status,
        startDate || new Date(),
        expiryDate || null,
        price || null,
        notes || null,
        req.user.id
      ]
    );

    // Log history
    await client.query(
      `INSERT INTO client_service_history (service_id, action, changed_by, changes)
       VALUES ($1, 'created', $2, $3)`,
      [
        result.rows[0].id,
        req.user.id,
        JSON.stringify(result.rows[0])
      ]
    );

    await client.query('COMMIT');

    console.log(`✅ Service created: ${result.rows[0].id} for client ${clientId}`);

    res.status(201).json({
      message: "Service created successfully",
      service: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creating service:", error);
    res.status(500).json({ error: "Failed to create service", message: error.message });
  } finally {
    client.release();
  }
};

// ==========================================
// 4. Update service
// ==========================================
export const updateService = async (req, res) => {
  const { serviceId } = req.params;
  const {
    serviceName,
    description,
    status,
    startDate,
    expiryDate,
    price,
    notes
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      'SELECT * FROM client_services WHERE id = $1',
      [serviceId]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Service not found" });
    }

    const oldService = currentResult.rows[0];

    const result = await client.query(
      `UPDATE client_services 
       SET 
         service_name = COALESCE($1, service_name),
         description = COALESCE($2, description),
         status = COALESCE($3, status),
         start_date = COALESCE($4, start_date),
         expiry_date = COALESCE($5, expiry_date),
         price = COALESCE($6, price),
         notes = COALESCE($7, notes),
         updated_by = $8
       WHERE id = $9
       RETURNING *`,
      [
        serviceName || null,
        description || null,
        status || null,
        startDate || null,
        expiryDate || null,
        price || null,
        notes || null,
        req.user.id,
        serviceId
      ]
    );

    const changes = {};
    Object.keys(result.rows[0]).forEach(key => {
      if (oldService[key] !== result.rows[0][key] && 
          !['updated_at', 'updated_by'].includes(key)) {
        changes[key] = {
          old: oldService[key],
          new: result.rows[0][key]
        };
      }
    });

    await client.query(
      `INSERT INTO client_service_history (service_id, action, changed_by, changes)
       VALUES ($1, 'updated', $2, $3)`,
      [serviceId, req.user.id, JSON.stringify(changes)]
    );

    await client.query('COMMIT');

    console.log(`✅ Service updated: ${serviceId}`);

    res.json({
      message: "Service updated successfully",
      service: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating service:", error);
    res.status(500).json({ error: "Failed to update service", message: error.message });
  } finally {
    client.release();
  }
};

// ==========================================
// 5. Delete service
// ==========================================
export const deleteService = async (req, res) => {
  const { serviceId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const serviceResult = await client.query(
      'SELECT * FROM client_services WHERE id = $1',
      [serviceId]
    );

    if (serviceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Service not found" });
    }

    await client.query(
      `INSERT INTO client_service_history (service_id, action, changed_by, changes)
       VALUES ($1, 'deleted', $2, $3)`,
      [serviceId, req.user.id, JSON.stringify(serviceResult.rows[0])]
    );

    await client.query('DELETE FROM client_services WHERE id = $1', [serviceId]);

    await client.query('COMMIT');

    console.log(`🗑️ Service deleted: ${serviceId}`);

    res.json({ message: "Service deleted successfully" });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error deleting service:", error);
    res.status(500).json({ error: "Failed to delete service", message: error.message });
  } finally {
    client.release();
  }
};

// ==========================================
// 6. Get service history
// ==========================================
export const getServiceHistory = async (req, res) => {
  const { serviceId } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const result = await pool.query(
      `SELECT 
         sh.*,
         u.email as "changedByEmail"
       FROM client_service_history sh
       LEFT JOIN users u ON sh.changed_by = u.id
       WHERE sh.service_id = $1
       ORDER BY sh.created_at DESC
       LIMIT $2 OFFSET $3`,
      [serviceId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM client_service_history WHERE service_id = $1',
      [serviceId]
    );
    const total = parseInt(countResult.rows[0].count);

    res.json({
      history: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching service history:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
};

// ==========================================
// 7. Get expiring services
// ==========================================
export const getExpiringServices = async (req, res) => {
  const { days = 30 } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
         cs.*,
         c.name as "clientName",
         c.email as "clientEmail",
         c.phone as "clientPhone"
       FROM client_services cs
       LEFT JOIN clients c ON cs.client_id = c.id
       WHERE cs.status = 'active'
       AND cs.expiry_date IS NOT NULL
       AND cs.expiry_date <= NOW() + INTERVAL '${parseInt(days)} days'
       AND cs.expiry_date >= NOW()
       ORDER BY cs.expiry_date ASC`,
      []
    );

    res.json({ services: result.rows });
  } catch (error) {
    console.error("Error fetching expiring services:", error);
    res.status(500).json({ error: "Failed to fetch expiring services" });
  }
};