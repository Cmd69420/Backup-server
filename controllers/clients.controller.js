// controllers/clients.controller.js - UPDATED with quota tracking
// Added atomic counter updates for client operations

import xlsx from "xlsx";
import { pool } from "../db.js";
import { getCoordinatesFromPincode, getCoordinatesFromAddress, getPincodeFromCoordinates } from "../services/geocoding.service.js";
import { startBackgroundGeocode } from "../utils/geocodeBatch.js";
import { incrementClientCount, decrementClientCount } from "../services/usage-tracker.js";

const CLIENT_SELECT_FIELDS = `
  id, 
  name, 
  email, 
  phone, 
  address,
  latitude, 
  longitude, 
  pincode,
  status, 
  notes,
  created_by as "createdBy", 
  created_at as "createdAt", 
  updated_at as "updatedAt",
  last_visit_date as "lastVisitDate",
  last_visit_type as "lastVisitType",
  last_visit_notes as "lastVisitNotes",
  CASE 
    WHEN latitude IS NOT NULL AND longitude IS NOT NULL 
    THEN true 
    ELSE false 
  END as "hasLocation"
`;

// ============================================
// ✅ UPDATED: UPLOAD EXCEL WITH QUOTA TRACKING
// ============================================
export const uploadExcel = async (req, res) => {
  const dbClient = await pool.connect();
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "NoFileUploaded" });
    }

    console.log("📥 Upload started:", req.file.originalname, req.file.size, "bytes");

    if (req.file.mimetype !== "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return res.status(400).json({ error: "OnlyXLSXAllowed" });
    }

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: "EmptyExcelFile" });
    }

    console.log(`📊 Processing ${rows.length} rows...`);

    await dbClient.query("BEGIN");

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const name = row.name || row.Name || null;
      const email = row.email || row.Email || null;
      
      let phone = row.phone || row.Phone || null;
      if (phone !== null && phone !== undefined && phone !== '') {
        phone = String(phone).trim().replace(/\s+/g, '');
      } else {
        phone = null;
      }
      
      const address = row.address || row.Address || null;
      const note = row.note || row.Note || row.notes || row.Notes || null;
      const status = row.status || row.Status || 'active';
      const source = row.source || row.Source || 'excel';

      let latitude = null;
      let longitude = null;
      let pincode = null;

      if (row.latitude || row.Latitude) {
        latitude = parseFloat(row.latitude || row.Latitude);
        if (isNaN(latitude)) latitude = null;
      }

      if (row.longitude || row.Longitude) {
        longitude = parseFloat(row.longitude || row.Longitude);
        if (isNaN(longitude)) longitude = null;
      }

      if (row.pincode || row.Pincode) {
        pincode = String(row.pincode || row.Pincode).trim();
        if (pincode.includes('.')) {
          pincode = pincode.split('.')[0];
        }
      }

      if (!name || !address) {
        console.log(`⚠️ Skipping row: missing name or address`);
        skipped++;
        continue;
      }

      // Geocode if needed
      if (pincode && (!latitude || !longitude)) {
        try {
          const geo = await getCoordinatesFromPincode(pincode);
          if (geo) {
            latitude = geo.latitude;
            longitude = geo.longitude;
            console.log(`🔍 Geocoded ${name} from pincode ${pincode}`);
          }
        } catch (err) {
          console.log(`⚠️ Geocoding failed for pincode ${pincode}`);
        }
      }

      if (!pincode && address && (!latitude || !longitude)) {
        try {
          const geo = await getCoordinatesFromAddress(address);
          if (geo) {
            latitude = latitude ?? geo.latitude;
            longitude = longitude ?? geo.longitude;
            pincode = pincode ?? geo.pincode;
            console.log(`🔍 Geocoded ${name} from address`);
          }
        } catch (err) {
          console.log(`⚠️ Geocoding failed for address: ${address}`);
        }
      }

      // Check for duplicates
      let duplicateCheck = { rows: [] };
      
      if (email) {
        duplicateCheck = await dbClient.query(
          `SELECT id FROM clients 
           WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) 
           AND created_by = $2
           AND company_id = $3
           LIMIT 1`,
          [email, req.user.id, req.companyId]
        );
      }
      
      if (duplicateCheck.rows.length === 0 && phone) {
        const cleanPhone = phone.replace(/\D/g, '');
        
        if (cleanPhone.length >= 10) {
          duplicateCheck = await dbClient.query(
            `SELECT id FROM clients 
             WHERE REGEXP_REPLACE(phone, '\\D', '', 'g') = $1 
             AND created_by = $2
             AND company_id = $3
             LIMIT 1`,
            [cleanPhone, req.user.id, req.companyId]
          );
        }
      }
      
      if (duplicateCheck.rows.length === 0) {
        const cleanName = name.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
        
        if (pincode) {
          duplicateCheck = await dbClient.query(
            `SELECT id FROM clients 
             WHERE LOWER(TRIM(REGEXP_REPLACE(name, '[^a-zA-Z0-9\\s]', '', 'g'))) = $1 
             AND pincode = $2
             AND created_by = $3
             AND company_id = $4
             LIMIT 1`,
            [cleanName, pincode, req.user.id, req.companyId]
          );
        } else {
          duplicateCheck = await dbClient.query(
            `SELECT id FROM clients 
             WHERE LOWER(TRIM(REGEXP_REPLACE(name, '[^a-zA-Z0-9\\s]', '', 'g'))) = $1
             AND created_by = $2
             AND company_id = $3
             LIMIT 1`,
            [cleanName, req.user.id, req.companyId]
          );
        }
      }

      // Update or insert
      if (duplicateCheck.rows.length > 0) {
        const existingId = duplicateCheck.rows[0].id;
        
        await dbClient.query(
          `UPDATE clients 
           SET 
             email = COALESCE($1, email),
             phone = COALESCE($2, phone),
             address = COALESCE($3, address),
             latitude = COALESCE($4, latitude),
             longitude = COALESCE($5, longitude),
             pincode = COALESCE($6, pincode),
             notes = COALESCE($7, notes),
             status = $8,
             updated_at = NOW()
           WHERE id = $9 AND created_by = $10 AND company_id = $11`,
          [email, phone, address, latitude, longitude, pincode, note, status, existingId, req.user.id, req.companyId]
        );

        updated++;
        console.log(`🔄 Updated: ${name} (ID: ${existingId})`);
        
      } else {
        // ✅ INSERT WITH COUNTER INCREMENT
        await dbClient.query(
          `INSERT INTO clients
           (name, email, phone, address, latitude, longitude, status, notes, created_by, source, pincode, company_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [name, email, phone, address, latitude, longitude, status, note, req.user.id, source, pincode, req.companyId]
        );

        // ✅ INCREMENT CLIENT COUNT
        await incrementClientCount(req.companyId, dbClient);

        imported++;
        console.log(`✅ Imported: ${name}`);
      }
    }

    await dbClient.query("COMMIT");

    const summary = {
      total: rows.length,
      imported,
      updated,
      skipped
    };

    console.log("✅ Upload completed:", summary);

    startBackgroundGeocode();

    res.json({
      status: "OK",
      summary
    });

  } catch (error) {
    await dbClient.query("ROLLBACK");
    console.error("❌ Upload error:", error);
    
    res.status(500).json({ 
      error: "UploadFailed", 
      message: error.message 
    });
  } finally {
    dbClient.release();
  }
};

// ============================================
// ✅ UPDATED: CREATE CLIENT WITH QUOTA TRACKING
// ============================================
export const createClient = async (req, res) => {
  const { name, email, phone, address, latitude, longitude, status, notes } = req.body;

  if (!name) {
    return res.status(400).json({ error: "ClientNameRequired" });
  }

  let pincode = null;
  if (latitude && longitude) {
    pincode = await getPincodeFromCoordinates(latitude, longitude);
  }

  // ============================================
  // ✅ ATOMIC TRANSACTION: Create + Increment
  // ============================================
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO clients (name, email, phone, address, latitude, longitude, status, notes, pincode, created_by, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${CLIENT_SELECT_FIELDS}`,
      [name, email || null, phone || null, address || null, latitude || null, longitude || null, status || "active", notes || null, pincode, req.user.id, req.companyId]
    );

    // ✅ INCREMENT CLIENT COUNT ATOMICALLY
    await incrementClientCount(req.companyId, client);

    await client.query('COMMIT');

    console.log(`✅ Client created: ${name} (Pincode: ${pincode || 'N/A'}) - Quota updated`);

    res.status(201).json({
      message: "ClientCreated",
      client: result.rows[0],
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Client creation failed:', error);
    res.status(500).json({ error: "ClientCreationFailed", message: error.message });
  } finally {
    client.release();
  }
};

export const getClients = async (req, res) => {
  const { 
    status, 
    search, 
    page = 1, 
    limit = 100, 
    searchMode = 'local'
  } = req.query;
  
  const offset = (page - 1) * limit;

  console.log(`👤 Fetching clients for user: ${req.user.id} | Company: ${req.companyId} | Mode: ${searchMode}`);

  if (searchMode === 'remote') {
    console.log(`🌐 Remote search mode`);

    let query = `
      SELECT ${CLIENT_SELECT_FIELDS}
      FROM clients
      WHERE company_id = $1
      AND (created_by IS NULL OR created_by = $2)
    `;
    const params = [req.companyId, req.user.id];
    let paramCount = 2;

    if (search && search.trim()) {
      paramCount++;
      
      if (/^\d+$/.test(search.trim())) {
        console.log(`🔢 Detected pincode search: ${search}`);
        query += ` AND pincode = $${paramCount}`;
        params.push(search.trim());
      } else {
        console.log(`📝 Detected text search: ${search}`);
        query += ` AND (
          name ILIKE $${paramCount} OR 
          address ILIKE $${paramCount} OR
          email ILIKE $${paramCount} OR
          phone ILIKE $${paramCount}
        )`;
        params.push(`%${search.trim()}%`);
      }
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += `
      ORDER BY 
        last_visit_date DESC NULLS LAST,
        created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    let countQuery = "SELECT COUNT(*) FROM clients WHERE company_id = $1 AND (created_by IS NULL OR created_by = $2)";
    const countParams = [req.companyId, req.user.id];
    let countParamIndex = 2;

    if (search && search.trim()) {
      countParamIndex++;
      if (/^\d+$/.test(search.trim())) {
        countQuery += ` AND pincode = $${countParamIndex}`;
        countParams.push(search.trim());
      } else {
        countQuery += ` AND (
          name ILIKE $${countParamIndex} OR 
          address ILIKE $${countParamIndex} OR
          email ILIKE $${countParamIndex} OR
          phone ILIKE $${countParamIndex}
        )`;
        countParams.push(`%${search.trim()}%`);
      }
    }

    if (status) {
      countParamIndex++;
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count);

    console.log(`✅ Remote search found ${result.rows.length} clients`);

    return res.json({
      clients: result.rows,
      userPincode: null,
      filteredByPincode: false,
      searchMode: 'remote',
      searchType: search && /^\d+$/.test(search.trim()) ? 'pincode' : 'text',
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  }

  // LOCAL MODE
  const userPincode = (await pool.query("SELECT pincode FROM users WHERE id = $1", [req.user.id])).rows[0]?.pincode;
  
  if (!userPincode) {
    return res.status(400).json({ 
      error: "NoPincodeFound",
      message: "Please enable location tracking first. No location data available."
    });
  }

  console.log(`📍 Local search mode - filtering by pincode: ${userPincode}`);

  let query = `
    SELECT ${CLIENT_SELECT_FIELDS}
    FROM clients
    WHERE pincode = $1
    AND company_id = $2
    AND (created_by IS NULL OR created_by = $3)
  `;
  const params = [userPincode, req.companyId, req.user.id];
  let paramCount = 3;

  if (status) {
    paramCount++;
    query += ` AND status = $${paramCount}`;
    params.push(status);
  }

  if (search) {
    paramCount++;
    query += ` AND (name ILIKE $${paramCount} OR email ILIKE $${paramCount} OR phone ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(parseInt(limit), parseInt(offset));

  const result = await pool.query(query, params);

  let countQuery = "SELECT COUNT(*) FROM clients WHERE pincode = $1 AND company_id = $2 AND (created_by IS NULL OR created_by = $3)";
  const countParams = [userPincode, req.companyId, req.user.id];
  let countParamIndex = 3;

  if (status) {
    countParamIndex++;
    countQuery += ` AND status = $${countParamIndex}`;
    countParams.push(status);
  }

  if (search) {
    countParamIndex++;
    countQuery += ` AND (name ILIKE $${countParamIndex} OR email ILIKE $${countParamIndex} OR phone ILIKE $${countParamIndex})`;
    countParams.push(`%${search}%`);
  }

  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].count);

  console.log(`✅ Local search found ${result.rows.length} clients in pincode ${userPincode}`);

  res.json({
    clients: result.rows,
    userPincode: userPincode,
    filteredByPincode: true,
    searchMode: 'local',
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: total,
      totalPages: Math.ceil(total / limit),
    },
  });
};

export const getClientById = async (req, res) => {
  const result = await pool.query(
    `SELECT ${CLIENT_SELECT_FIELDS}
     FROM clients
     WHERE id = $1 AND company_id = $2`,
    [req.params.id, req.companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ClientNotFound" });
  }

  res.json({ client: result.rows[0] });
};

export const updateClient = async (req, res) => {
  const { name, email, phone, address, latitude, longitude, status, notes } = req.body;

  let pincode = null;
  if (latitude && longitude) {
    pincode = await getPincodeFromCoordinates(latitude, longitude);
  }

  const result = await pool.query(
    `UPDATE clients 
     SET name = $1, email = $2, phone = $3, address = $4, latitude = $5, longitude = $6, status = $7, notes = $8, pincode = $9
     WHERE id = $10 AND company_id = $11
     RETURNING ${CLIENT_SELECT_FIELDS}`,
    [name, email, phone, address, latitude, longitude, status, notes, pincode, req.params.id, req.companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "ClientNotFound" });
  }

  res.json({
    message: "ClientUpdated",
    client: result.rows[0],
  });
};



/**
 * Update client address with automatic re-geocoding
 * PATCH /clients/:id/address
 */
export const updateClientAddress = async (req, res) => {
  const { id } = req.params;
  const { address } = req.body;

  if (!address || address.trim().length === 0) {
    return res.status(400).json({
      error: "ValidationError",
      message: "Address is required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verify client exists and belongs to user's company
    const existingClient = await client.query(
      `SELECT id, name, address, latitude, longitude, pincode 
       FROM clients 
       WHERE id = $1 AND company_id = $2`,
      [id, req.companyId]
    );

    if (existingClient.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: "ClientNotFound",
        message: "Client not found"
      });
    }

    const oldClient = existingClient.rows[0];
    const newAddress = address.trim();

    // Check if address actually changed
    if (oldClient.address === newAddress) {
      await client.query('ROLLBACK');
      return res.json({
        message: "AddressUnchanged",
        client: {
          ...oldClient,
          hasLocation: !!(oldClient.latitude && oldClient.longitude)
        }
      });
    }

    console.log(`📍 Updating address for client ${id}: ${oldClient.name}`);
    console.log(`   Old: ${oldClient.address}`);
    console.log(`   New: ${newAddress}`);

    // Try to geocode the new address
    let latitude = null;
    let longitude = null;
    let pincode = null;
    let geocodeSuccess = false;

    try {
      const geocodeResult = await getCoordinatesFromAddress(newAddress);
      
      if (geocodeResult) {
        latitude = geocodeResult.latitude;
        longitude = geocodeResult.longitude;
        pincode = geocodeResult.pincode;
        geocodeSuccess = true;
        
        console.log(`   ✅ Geocoded: ${latitude}, ${longitude}`);
        if (pincode) {
          console.log(`   📮 Pincode extracted: ${pincode}`);
        }
      } else {
        console.log(`   ⚠️ Geocoding failed, updating address without coordinates`);
      }
    } catch (geocodeError) {
      console.error(`   ❌ Geocoding error:`, geocodeError.message);
      // Continue without coordinates
    }

    // Update client with new address and coordinates (if available)
    const updateResult = await client.query(
      `UPDATE clients 
       SET address = $1,
           latitude = COALESCE($2, latitude),
           longitude = COALESCE($3, longitude),
           pincode = COALESCE($4, pincode),
           updated_at = NOW()
       WHERE id = $5
       RETURNING ${CLIENT_SELECT_FIELDS}`,
      [newAddress, latitude, longitude, pincode, id]
    );

    await client.query('COMMIT');

    const updatedClient = updateResult.rows[0];
    
    // Add hasLocation field for Android
    updatedClient.hasLocation = !!(updatedClient.latitude && updatedClient.longitude);

    console.log(`✅ Address updated for ${updatedClient.name}`);
    console.log(`   Geocoded: ${geocodeSuccess ? '✓' : '✗'}`);
    console.log(`   Coordinates: ${updatedClient.hasLocation ? '✓' : '✗'}`);

    res.json({
      message: "AddressUpdated",
      client: updatedClient,
      geocoded: geocodeSuccess,
      coordinatesAvailable: updatedClient.hasLocation
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("❌ UPDATE ADDRESS ERROR:", err);
    
    res.status(500).json({ 
      error: "ServerError", 
      message: "Failed to update address",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });

  } finally {
    client.release();
  }
};



// ============================================
// ✅ UPDATED: DELETE CLIENT WITH QUOTA TRACKING
// ============================================
export const deleteClient = async (req, res) => {
  // ============================================
  // ✅ ATOMIC TRANSACTION: Delete + Decrement
  // ============================================
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const result = await client.query(
      "DELETE FROM clients WHERE id = $1 AND company_id = $2 RETURNING id, name",
      [req.params.id, req.companyId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "ClientNotFound" });
    }

    // ✅ DECREMENT CLIENT COUNT ATOMICALLY
    await decrementClientCount(req.companyId, client);

    await client.query('COMMIT');

    console.log(`🗑️ Client deleted: ${result.rows[0].name} - Quota updated`);

    res.json({ message: "ClientDeleted" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Client deletion failed:', error);
    res.status(500).json({ error: "ClientDeletionFailed", message: error.message });
  } finally {
    client.release();
  }
};