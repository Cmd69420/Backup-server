import { pool } from "../db.js";
// REMOVED: import { startBackgroundGeocode } from "../utils/geocodeBatch.js";
// REMOVED: import { getCoordinatesFromAddress, getCoordinatesFromPincode } from "../services/geocoding.service.js";

export const syncTallyClients = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { clients: tallyClients } = req.body;

    if (!tallyClients || !Array.isArray(tallyClients)) {
      return res.status(400).json({ 
        error: "InvalidPayload", 
        message: "Expected array of clients" 
      });
    }

    console.log(`🔥 Tally sync started: ${tallyClients.length} clients received`);

    await client.query("BEGIN");

    let newCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    let receivedWithCoords = 0;
    const errors = [];

    for (const tallyClient of tallyClients) {
      try {
        const {
          tally_guid,
          name,
          email,
          phone,
          address,
          pincode,
          latitude,
          longitude,
          status = "active",
          notes,
          source = "tally"
        } = tallyClient;

        if (!name) {
          failedCount++;
          errors.push({ tally_guid, error: "Missing name" });
          continue;
        }

        // Count clients that came with coordinates
        if (latitude && longitude) {
          receivedWithCoords++;
        }

        // ✅ USE COORDINATES AS-IS FROM MIDDLEWARE (no server-side geocoding)
        const finalLat = latitude || null;
        const finalLng = longitude || null;

        let existingClient = null;
        
        // Check by GUID first
        if (tally_guid) {
          const guidResult = await client.query(
            "SELECT * FROM clients WHERE tally_guid = $1 LIMIT 1",
            [tally_guid]
          );
          if (guidResult.rows.length > 0) {
            existingClient = guidResult.rows[0];
          }
        }
        
        // Check by email
        if (!existingClient && email) {
          const emailResult = await client.query(
            "SELECT * FROM clients WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1",
            [email]
          );
          if (emailResult.rows.length > 0) {
            existingClient = emailResult.rows[0];
          }
        }

        // Check by phone
        if (!existingClient && phone) {
          const cleanPhone = phone.replace(/\D/g, '');
          if (cleanPhone.length >= 10) {
            const phoneResult = await client.query(
              "SELECT * FROM clients WHERE REGEXP_REPLACE(phone, '\\D', '', 'g') = $1 LIMIT 1",
              [cleanPhone]
            );
            if (phoneResult.rows.length > 0) {
              existingClient = phoneResult.rows[0];
            }
          }
        }

        let clientId;

        if (existingClient) {
          // Update existing client - ONLY update coordinates if they're NULL
          const updateResult = await client.query(
            `UPDATE clients 
             SET name = $1, 
                 email = COALESCE($2, email), 
                 phone = COALESCE($3, phone), 
                 address = COALESCE($4, address), 
                 latitude = CASE 
                   WHEN latitude IS NULL THEN $5 
                   ELSE latitude 
                 END,
                 longitude = CASE 
                   WHEN longitude IS NULL THEN $6 
                   ELSE longitude 
                 END,
                 status = $7, 
                 notes = COALESCE($8, notes), 
                 pincode = COALESCE($9, pincode),
                 tally_guid = COALESCE($10, tally_guid),
                 source = $11,
                 updated_at = NOW()
             WHERE id = $12
             RETURNING id, latitude, longitude`,
            [
              name, email, phone, address, finalLat, finalLng, 
              status, notes, pincode, tally_guid, source, existingClient.id
            ]
          );
          
          clientId = updateResult.rows[0].id;
          const hasCoordinates = updateResult.rows[0].latitude && updateResult.rows[0].longitude;
          
          updatedCount++;
          console.log(`✏️  Updated: ${name} (${clientId}) - Coords: ${hasCoordinates ? '✔' : '✗'}`);

        } else {
          // Insert new client
          const insertResult = await client.query(
            `INSERT INTO clients 
             (name, email, phone, address, latitude, longitude, status, notes, 
              pincode, tally_guid, source, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)
             RETURNING id`,
            [name, email, phone, address, finalLat, finalLng, status, notes, 
             pincode, tally_guid, source]
          );
          
          clientId = insertResult.rows[0].id;
          newCount++;
          console.log(`✨ Created: ${name} (${clientId}) - Coords: ${finalLat ? '✔' : '✗'}`);
        }

        // Update Tally mapping table
        if (tally_guid && clientId) {
          await client.query(
            `INSERT INTO tally_client_mapping (tally_ledger_id, client_id, last_synced_at, sync_status)
             VALUES ($1, $2, NOW(), 'synced')
             ON CONFLICT (tally_ledger_id) 
             DO UPDATE SET client_id = $2, last_synced_at = NOW(), sync_status = 'synced'`,
            [tally_guid, clientId]
          );
        }

      } catch (error) {
        console.error(`❌ Failed to sync ${tallyClient.name}:`, error.message);
        failedCount++;
        errors.push({ 
          tally_guid: tallyClient.tally_guid, 
          name: tallyClient.name,
          error: error.message 
        });
      }
    }

    // Log sync to database
    await client.query(
      `INSERT INTO tally_sync_log 
       (sync_started_at, sync_completed_at, total_records, new_records, 
        updated_records, failed_records, errors, status, triggered_by)
       VALUES (NOW(), NOW(), $1, $2, $3, $4, $5, 'completed', 'middleware')`,
      [tallyClients.length, newCount, updatedCount, failedCount, JSON.stringify(errors)]
    );

    await client.query("COMMIT");

    console.log(`\n✅ Tally sync completed:`);
    console.log(`   📊 Total: ${tallyClients.length}`);
    console.log(`   ✨ New: ${newCount}`);
    console.log(`   ✏️  Updated: ${updatedCount}`);
    console.log(`   🌍 Received with coordinates: ${receivedWithCoords}`);
    console.log(`   ❌ Failed: ${failedCount}`);

    // Check for remaining clients missing coordinates
    const missingCoordsResult = await pool.query(
      `SELECT COUNT(*) FROM clients 
       WHERE (latitude IS NULL OR longitude IS NULL)`
    );
    const missingCoords = parseInt(missingCoordsResult.rows[0].count);
    
    console.log(`\n📍 Geocoding Status:`);
    console.log(`   Clients without coordinates: ${missingCoords}`);
    console.log(`   ℹ️  Note: Server-side geocoding is disabled. Please geocode in middleware.`);

    res.status(200).json({
      message: "SyncCompleted",
      summary: {
        total: tallyClients.length,
        new: newCount,
        updated: updatedCount,
        failed: failedCount,
        receivedWithCoordinates: receivedWithCoords
      },
      geocoding: {
        clientsMissingCoords: missingCoords,
        note: "Server-side geocoding disabled. Geocode in middleware before upload."
      },
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ TALLY SYNC ERROR:", err);
    console.error("Stack:", err.stack);
    
    try {
      await pool.query(
        `INSERT INTO tally_sync_log 
         (sync_started_at, sync_completed_at, total_records, failed_records, 
          errors, status, triggered_by)
         VALUES (NOW(), NOW(), 0, 0, $1, 'failed', 'middleware')`,
        [JSON.stringify([{ error: err.message, stack: err.stack }])]
      );
    } catch (logError) {
      console.error("Failed to log sync error:", logError);
    }
    
    res.status(500).json({ 
      error: "SyncFailed", 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

  } finally {
    client.release();
  }
};

export const getSyncStatus = async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM tally_sync_log 
     ORDER BY sync_started_at DESC 
     LIMIT 10`
  );

  res.json({
    syncs: result.rows.map(row => ({
      id: row.id,
      startedAt: row.sync_started_at,
      completedAt: row.sync_completed_at,
      total: row.total_records,
      new: row.new_records,
      updated: row.updated_records,
      failed: row.failed_records,
      status: row.status,
      triggeredBy: row.triggered_by,
      errors: row.errors ? JSON.parse(row.errors) : []
    }))
  });
};

export const getLatestSync = async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM tally_sync_log 
     WHERE status = 'completed'
     ORDER BY sync_started_at DESC 
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return res.json({ 
      message: "NoSyncsYet",
      lastSync: null 
    });
  }

  const sync = result.rows[0];
  res.json({
    lastSync: {
      completedAt: sync.sync_completed_at,
      total: sync.total_records,
      new: sync.new_records,
      updated: sync.updated_records,
      failed: sync.failed_records,
      status: sync.status
    }
  });
};

export const triggerSync = async (req, res) => {
  await pool.query(
    `INSERT INTO tally_sync_log 
     (sync_started_at, total_records, status, triggered_by)
     VALUES (NOW(), 0, 'running', 'manual')
     RETURNING id`
  );

  res.json({ 
    message: "SyncTriggered",
    note: "Middleware should start syncing now"
  });
};

export const getClientGuids = async (req, res) => {
  const result = await pool.query(
    `SELECT tally_guid FROM clients WHERE tally_guid IS NOT NULL`
  );
  
  res.json({
    guids: result.rows.map(r => r.tally_guid)
  });
};