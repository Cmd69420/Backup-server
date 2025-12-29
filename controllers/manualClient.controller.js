import { pool } from "../db.js";
import { getCoordinatesFromAddress, getCoordinatesFromPincode } from "../services/geocoding.service.js";

export const createClient = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const {
      name,
      email,
      phone,
      address,
      pincode,
      notes
    } = req.body;

    // Validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ 
        error: "ValidationError", 
        message: "Client name is required" 
      });
    }

    // Validate email format if provided
    if (email && email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: "ValidationError",
          message: "Invalid email format"
        });
      }
    }

    // Validate phone format if provided
    if (phone && phone.trim().length > 0) {
      const phoneRegex = /^[0-9]{10,15}$/;
      if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
        return res.status(400).json({
          error: "ValidationError",
          message: "Phone must be 10-15 digits"
        });
      }
    }

    // Validate pincode if provided
    if (pincode && pincode.trim().length > 0) {
      if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
        return res.status(400).json({
          error: "ValidationError",
          message: "Pincode must be 6 digits"
        });
      }
    }

    await client.query("BEGIN");

    // Check for duplicates
    if (email && email.trim().length > 0) {
      const emailCheck = await client.query(
        "SELECT id FROM clients WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1",
        [email]
      );
      if (emailCheck.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "DuplicateError",
          message: "Client with this email already exists"
        });
      }
    }

    if (phone && phone.trim().length > 0) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        const phoneCheck = await client.query(
          "SELECT id FROM clients WHERE REGEXP_REPLACE(phone, '\\D', '', 'g') = $1 LIMIT 1",
          [cleanPhone]
        );
        if (phoneCheck.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: "DuplicateError",
            message: "Client with this phone number already exists"
          });
        }
      }
    }

    // 🌍 Geocode the address or pincode
    let latitude = null;
    let longitude = null;
    let geocodeSource = null;

    console.log(`🔍 Geocoding for new client: ${name}`);

    // Try geocoding from full address first
    if (address && address.trim().length > 0) {
      console.log(`   📍 Trying address: ${address}`);
      const coords = await getCoordinatesFromAddress(address);
      if (coords) {
        latitude = coords.latitude; 
        longitude = coords.longitude;
        geocodeSource = 'address';
        console.log(`   ✅ Address geocoded: ${latitude}, ${longitude}`);
      }
    }

    // Fallback to pincode if address geocoding failed
    if (!latitude && pincode && pincode.trim().length === 6) {
      console.log(`   📍 Trying pincode: ${pincode}`);
      const coords = await getCoordinatesFromPincode(pincode);
      if (coords) {
        latitude = coords.latitude; 
        longitude = coords.longitude;  
        geocodeSource = 'pincode';
        console.log(`   ✅ Pincode geocoded: ${latitude}, ${longitude}`);
      }
    }

    if (!latitude) {
      console.log(`   ⚠️ Geocoding failed - client will be created without coordinates`);
    }

    // Insert the new client
    const insertResult = await client.query(
      `INSERT INTO clients 
       (name, email, phone, address, latitude, longitude, 
        status, notes, pincode, source, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [
        name.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        address?.trim() || null,
        latitude,
        longitude,
        'active',
        notes?.trim() || null,
        pincode?.trim() || null,
        'app',
        req.user.id
      ]
    );

    await client.query("COMMIT");

    const newClient = insertResult.rows[0];

    console.log(`✅ Client created: ${newClient.name} (ID: ${newClient.id})`);
    console.log(`   Coordinates: ${latitude ? '✓' : '✗'} (${geocodeSource || 'none'})`);

    res.status(201).json({
      message: "ClientCreated",
      client: {
        id: newClient.id,
        name: newClient.name,
        email: newClient.email,
        phone: newClient.phone,
        address: newClient.address,
        pincode: newClient.pincode,
        latitude: newClient.latitude,
        longitude: newClient.longitude,
        notes: newClient.notes,
        status: newClient.status,
        source: newClient.source,
        createdAt: newClient.created_at,
        geocoded: !!latitude,
        geocodeSource: geocodeSource
      }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ CREATE CLIENT ERROR:", err);
    
    res.status(500).json({ 
      error: "ServerError", 
      message: "Failed to create client",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });

  } finally {
    client.release();
  }
};

export const getClients = async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    status = 'active',
    source,
    search 
  } = req.query;

  const offset = (page - 1) * limit;

  let query = `
    SELECT 
      id, name, email, phone, address, pincode, 
      latitude, longitude, status, notes, source,
      tally_guid, created_at, updated_at
    FROM clients
    WHERE 1=1
  `;
  
  const params = [];
  let paramIndex = 1;

  if (status && status !== 'all') {
    query += ` AND status = $${paramIndex}`;
    params.push(status);
    paramIndex++;
  }

  if (source) {
    query += ` AND source = $${paramIndex}`;
    params.push(source);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      name ILIKE $${paramIndex} OR 
      email ILIKE $${paramIndex} OR 
      phone ILIKE $${paramIndex} OR
      address ILIKE $${paramIndex}
    )`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  // Get total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM clients WHERE 1=1` + 
    (status && status !== 'all' ? ` AND status = '${status}'` : '') +
    (source ? ` AND source = '${source}'` : '') +
    (search ? ` AND (name ILIKE '%${search}%' OR email ILIKE '%${search}%')` : '')
  );

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);

  res.json({
    clients: result.rows,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: parseInt(countResult.rows[0].count),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    }
  });
};

export const getClientById = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `SELECT * FROM clients WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      error: "NotFound",
      message: "Client not found"
    });
  }

  res.json({
    client: result.rows[0]
  });
};

export const updateClient = async (req, res) => {
  const client = await pool.connect();
  const { id } = req.params;
  const {
    name,
    email,
    phone,
    address,
    pincode,
    notes,
    status
  } = req.body;

  try {
    await client.query("BEGIN");

    // Check if client exists
    const existingClient = await client.query(
      "SELECT * FROM clients WHERE id = $1",
      [id]
    );

    if (existingClient.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "NotFound",
        message: "Client not found"
      });
    }

    const oldClient = existingClient.rows[0];

    // 🌍 Re-geocode if address or pincode changed
    let latitude = oldClient.latitude;
    let longitude = oldClient.longitude;
    let geocodeSource = null;

    const addressChanged = address && address !== oldClient.address;
    const pincodeChanged = pincode && pincode !== oldClient.pincode;

    if (addressChanged || pincodeChanged) {
      console.log(`🔍 Re-geocoding client ${id}: ${name || oldClient.name}`);

      // Try new address first
      if (addressChanged) {
        const coords = await getCoordinatesFromAddress(address);
        if (coords) {
          latitude = coords.latitude;  // 👈 Changed from coords.lat
          longitude = coords.longitude;
          geocodeSource = 'address';
          console.log(`   ✅ New address geocoded`);
        }
      }

      // Fallback to new pincode
      if (!latitude && pincodeChanged) {
        const coords = await getCoordinatesFromPincode(pincode);
        if (coords) {
          latitude = coords.latitude;  // 👈 Changed from coords.lat
          longitude = coords.longitude;
          geocodeSource = 'pincode';
          console.log(`   ✅ New pincode geocoded`);
        }
      }
    }

    // Update client
    const updateResult = await client.query(
      `UPDATE clients 
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           address = COALESCE($4, address),
           pincode = COALESCE($5, pincode),
           latitude = COALESCE($6, latitude),
           longitude = COALESCE($7, longitude),
           notes = COALESCE($8, notes),
           status = COALESCE($9, status),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [name, email, phone, address, pincode, latitude, longitude, notes, status, id]
    );

    await client.query("COMMIT");

    console.log(`✅ Client updated: ${updateResult.rows[0].name} (ID: ${id})`);

    res.json({
      message: "ClientUpdated",
      client: updateResult.rows[0],
      regeocoded: geocodeSource ? true : false,
      geocodeSource: geocodeSource
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ UPDATE CLIENT ERROR:", err);
    
    res.status(500).json({ 
      error: "ServerError", 
      message: "Failed to update client",
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });

  } finally {
    client.release();
  }
};

export const deleteClient = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    "DELETE FROM clients WHERE id = $1 RETURNING id, name",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      error: "NotFound",
      message: "Client not found"
    });
  }

  console.log(`🗑️ Client deleted: ${result.rows[0].name} (ID: ${id})`);

  res.json({
    message: "ClientDeleted",
    deletedClient: result.rows[0]
  });
};

export const searchClients = async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      error: "ValidationError",
      message: "Search query must be at least 2 characters"
    });
  }

  const result = await pool.query(
    `SELECT 
      id, name, email, phone, address, pincode, 
      latitude, longitude, status
    FROM clients
    WHERE 
      name ILIKE $1 OR 
      email ILIKE $1 OR 
      phone ILIKE $1 OR
      address ILIKE $1 OR
      pincode ILIKE $1
    ORDER BY name
    LIMIT 20`,
    [`%${q}%`]
  );

  res.json({
    results: result.rows,
    count: result.rows.length
  });
};