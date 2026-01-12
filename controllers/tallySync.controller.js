// controllers/tallySync.controller.js
// Bidirectional Tally Sync Controller

import { pool } from "../db.js";

/**
 * Get pending sync queue items for a company
 * GET /api/tally-sync/queue
 */
export const getSyncQueue = async (req, res) => {
  const { status = 'pending', limit = 50, page = 1 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const validStatuses = ['pending', 'processing', 'failed', 'completed'];
    const filterStatus = validStatuses.includes(status) ? status : 'pending';

    const result = await pool.query(
      `SELECT * FROM tally_sync_pending_dashboard
       WHERE company_id = $1
       AND status = $2
       ORDER BY priority ASC, created_at ASC
       LIMIT $3 OFFSET $4`,
      [req.companyId, filterStatus, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM tally_sync_queue
       WHERE company_id = $1 AND status = $2`,
      [req.companyId, filterStatus]
    );

    const total = parseInt(countResult.rows[0].count);

    console.log(`📋 Fetched ${result.rows.length} sync queue items (status: ${filterStatus})`);

    res.json({
      queue: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('❌ Error fetching sync queue:', error);
    res.status(500).json({
      error: 'FetchQueueFailed',
      message: error.message
    });
  }
};

/**
 * Get sync statistics for company dashboard
 * GET /api/tally-sync/stats
 */
export const getSyncStats = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM tally_sync_stats WHERE company_id = $1`,
      [req.companyId]
    );

    const stats = result.rows[0] || {
      pending_count: 0,
      processing_count: 0,
      failed_count: 0,
      completed_count: 0
    };

    // Get recent sync history
    const historyResult = await pool.query(
      `SELECT 
         DATE(synced_at) as date,
         COUNT(*) FILTER (WHERE status = 'success') as successful,
         COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM tally_sync_history
       WHERE company_id = $1
       AND synced_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(synced_at)
       ORDER BY date DESC`,
      [req.companyId]
    );

    res.json({
      stats: {
        pending: parseInt(stats.pending_count),
        processing: parseInt(stats.processing_count),
        failed: parseInt(stats.failed_count),
        completed: parseInt(stats.completed_count),
        avgCompletionMinutes: parseFloat(stats.avg_completion_minutes || 0).toFixed(2)
      },
      recentHistory: historyResult.rows
    });

  } catch (error) {
    console.error('❌ Error fetching sync stats:', error);
    res.status(500).json({
      error: 'FetchStatsFailed',
      message: error.message
    });
  }
};

/**
 * Process sync queue - Send pending updates to Tally
 * POST /api/tally-sync/process
 */
export const processSyncQueue = async (req, res) => {
  const { batchSize = 20 } = req.body;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get company Tally credentials
    const companyResult = await client.query(
      `SELECT 
         id,
         name,
         tally_company_name,
         tally_username,
         tally_password_encrypted,
         tally_auto_sync_enabled
       FROM companies
       WHERE id = $1`,
      [req.companyId]
    );

    if (companyResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'CompanyNotFound' });
    }

    const company = companyResult.rows[0];

    if (!company.tally_company_name) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'TallyNotConfigured',
        message: 'Tally credentials not configured for this company'
      });
    }

    // Get pending items
    const queueResult = await client.query(
      `SELECT 
         q.*,
         c.name as client_name,
         c.address as current_address,
         c.phone as current_phone,
         c.email as current_email
       FROM tally_sync_queue q
       JOIN clients c ON q.client_id = c.id
       WHERE q.company_id = $1
       AND q.status = 'pending'
       AND q.attempts < q.max_attempts
       ORDER BY q.priority ASC, q.created_at ASC
       LIMIT $2`,
      [req.companyId, batchSize]
    );

    const pendingItems = queueResult.rows;

    if (pendingItems.length === 0) {
      await client.query('COMMIT');
      return res.json({
        message: 'NoItemsToProcess',
        processed: 0
      });
    }

    console.log(`\n🔄 Processing ${pendingItems.length} Tally sync items for ${company.name}`);

    const results = {
      total: pendingItems.length,
      successful: 0,
      failed: 0,
      items: []
    };

    for (const item of pendingItems) {
      // Mark as processing
      await client.query(
        `UPDATE tally_sync_queue
         SET status = 'processing',
             attempts = attempts + 1,
             processed_at = NOW()
         WHERE id = $1`,
        [item.id]
      );

      console.log(`\n📤 Processing: ${item.client_name} (${item.operation})`);

      let success = false;
      let errorMessage = null;
      let tallyResponse = null;

      try {
        // Call middleware to push update to Tally
        const middlewareResponse = await fetch(`${process.env.MIDDLEWARE_URL || 'http://localhost:5001'}/api/tally/push-update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-middleware-token': process.env.MIDDLEWARE_TOKEN || 'tally-middleware-secret-key-12345'
          },
          body: JSON.stringify({
            tallyGuid: item.tally_guid,
            tallyCompanyName: company.tally_company_name,
            username: company.tally_username || '',
            password: company.tally_password_encrypted || '', // Decrypt in production
            operation: item.operation,
            data: item.new_data
          }),
          timeout: 30000
        });

        const middlewareResult = await middlewareResponse.json();
        
        success = middlewareResult.success;
        errorMessage = middlewareResult.error || null;
        tallyResponse = middlewareResult.tallyResponse || null;

        if (success) {
          console.log(`   ✅ Success: ${item.client_name}`);
        } else {
          console.log(`   ❌ Failed: ${errorMessage}`);
        }

      } catch (error) {
        errorMessage = `Middleware error: ${error.message}`;
        console.log(`   ❌ Error: ${errorMessage}`);
      }

      // Update queue item
      if (success) {
        await client.query(
          `UPDATE tally_sync_queue
           SET status = 'completed',
               completed_at = NOW()
           WHERE id = $1`,
          [item.id]
        );

        // Update client sync status
        await client.query(
          `UPDATE clients
           SET tally_sync_status = 'synced',
               tally_sync_pending_fields = '{}',
               last_tally_sync_at = NOW(),
               tally_sync_error = NULL
           WHERE id = $1`,
          [item.client_id]
        );

        results.successful++;

      } else {
        const newStatus = item.attempts >= item.max_attempts ? 'failed' : 'pending';

        await client.query(
          `UPDATE tally_sync_queue
           SET status = $2,
               last_error = $3
           WHERE id = $1`,
          [item.id, newStatus, errorMessage]
        );

        // Update client error
        await client.query(
          `UPDATE clients
           SET tally_sync_status = $2,
               tally_sync_error = $3
           WHERE id = $1`,
          [item.client_id, newStatus, errorMessage]
        );

        results.failed++;
      }

      // Log to history
      await client.query(
        `INSERT INTO tally_sync_history (
           queue_id,
           client_id,
           tally_guid,
           operation,
           old_data,
           new_data,
           status,
           error_message,
           tally_response,
           user_id,
           company_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          item.id,
          item.client_id,
          item.tally_guid,
          item.operation,
          item.old_data,
          item.new_data,
          success ? 'success' : 'failed',
          errorMessage,
          tallyResponse,
          item.user_id,
          req.companyId
        ]
      );

      results.items.push({
        id: item.id,
        clientName: item.client_name,
        operation: item.operation,
        success,
        error: errorMessage
      });

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    await client.query('COMMIT');

    console.log(`\n✅ Batch complete: ${results.successful} succeeded, ${results.failed} failed\n`);

    res.json({
      message: 'ProcessingComplete',
      summary: {
        total: results.total,
        successful: results.successful,
        failed: results.failed
      },
      items: results.items
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Sync processing error:', error);
    
    res.status(500).json({
      error: 'ProcessingFailed',
      message: error.message
    });

  } finally {
    client.release();
  }
};

/**
 * Retry failed sync items
 * POST /api/tally-sync/retry/:queueId
 */
export const retrySyncItem = async (req, res) => {
  const { queueId } = req.params;

  try {
    // Reset item to pending
    const result = await pool.query(
      `UPDATE tally_sync_queue
       SET status = 'pending',
           attempts = 0,
           last_error = NULL
       WHERE id = $1
       AND company_id = $2
       AND status = 'failed'
       RETURNING id, client_id`,
      [queueId, req.companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'QueueItemNotFound' });
    }

    // Reset client status
    await pool.query(
      `UPDATE clients
       SET tally_sync_status = 'pending',
           tally_sync_error = NULL
       WHERE id = $1`,
      [result.rows[0].client_id]
    );

    console.log(`🔄 Retry queued for item: ${queueId}`);

    res.json({
      message: 'RetryQueued',
      queueId
    });

  } catch (error) {
    console.error('❌ Retry failed:', error);
    res.status(500).json({
      error: 'RetryFailed',
      message: error.message
    });
  }
};

/**
 * Get sync conflicts requiring manual resolution
 * GET /api/tally-sync/conflicts
 */
export const getSyncConflicts = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         c.*,
         cl.name as client_name,
         cl.address as current_address,
         cl.phone as current_phone,
         u.email as resolved_by_email
       FROM tally_sync_conflicts c
       JOIN clients cl ON c.client_id = cl.id
       LEFT JOIN users u ON c.resolved_by = u.id
       WHERE c.company_id = $1
       AND c.resolution_status = 'pending'
       ORDER BY c.detected_at DESC`,
      [req.companyId]
    );

    console.log(`⚠️ Found ${result.rows.length} unresolved conflicts`);

    res.json({
      conflicts: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ Error fetching conflicts:', error);
    res.status(500).json({
      error: 'FetchConflictsFailed',
      message: error.message
    });
  }
};

/**
 * Resolve a sync conflict
 * POST /api/tally-sync/conflicts/:conflictId/resolve
 */
export const resolveConflict = async (req, res) => {
  const { conflictId } = req.params;
  const { resolution, notes } = req.body; // 'backend_wins' or 'tally_wins'

  if (!['backend_wins', 'tally_wins'].includes(resolution)) {
    return res.status(400).json({
      error: 'InvalidResolution',
      message: 'Resolution must be either backend_wins or tally_wins'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get conflict details
    const conflictResult = await client.query(
      `SELECT * FROM tally_sync_conflicts
       WHERE id = $1 AND company_id = $2`,
      [conflictId, req.companyId]
    );

    if (conflictResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'ConflictNotFound' });
    }

    const conflict = conflictResult.rows[0];

    // Mark conflict as resolved
    await client.query(
      `UPDATE tally_sync_conflicts
       SET resolution_status = $1,
           resolved_by = $2,
           resolved_at = NOW(),
           resolution_notes = $3
       WHERE id = $4`,
      [resolution, req.user.id, notes || null, conflictId]
    );

    if (resolution === 'backend_wins') {
      // Queue update to push backend value to Tally
      await client.query(
        `INSERT INTO tally_sync_queue (
           client_id,
           tally_guid,
           operation,
           new_data,
           priority,
           user_id,
           company_id
         ) VALUES ($1, $2, $3, $4, 1, $5, $6)`,
        [
          conflict.client_id,
          conflict.tally_guid,
          `update_${conflict.field_name}`,
          JSON.stringify({ [conflict.field_name]: conflict.backend_value }),
          req.user.id,
          req.companyId
        ]
      );

      console.log(`✅ Conflict resolved: Backend wins - ${conflict.field_name}`);

    } else {
      // Update backend with Tally value
      const updateQuery = `UPDATE clients SET ${conflict.field_name} = $1 WHERE id = $2`;
      await client.query(updateQuery, [conflict.tally_value, conflict.client_id]);

      console.log(`✅ Conflict resolved: Tally wins - ${conflict.field_name}`);
    }

    await client.query('COMMIT');

    res.json({
      message: 'ConflictResolved',
      resolution
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Conflict resolution failed:', error);
    
    res.status(500).json({
      error: 'ResolutionFailed',
      message: error.message
    });

  } finally {
    client.release();
  }
};

/**
 * Get sync history for a client
 * GET /api/tally-sync/history/:clientId
 */
export const getClientSyncHistory = async (req, res) => {
  const { clientId } = req.params;
  const { limit = 20 } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
         h.*,
         u.email as changed_by_email
       FROM tally_sync_history h
       LEFT JOIN users u ON h.user_id = u.id
       WHERE h.client_id = $1
       AND h.company_id = $2
       ORDER BY h.synced_at DESC
       LIMIT $3`,
      [clientId, req.companyId, limit]
    );

    res.json({
      history: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ Error fetching sync history:', error);
    res.status(500).json({
      error: 'FetchHistoryFailed',
      message: error.message
    });
  }
};

/**
 * Configure Tally credentials for company (Admin only)
 * POST /api/tally-sync/configure
 */
export const configureTallyCredentials = async (req, res) => {
  const {
    tallyCompanyName,
    tallyUsername,
    tallyPassword,
    autoSyncEnabled,
    syncIntervalMinutes
  } = req.body;

  if (!tallyCompanyName) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Tally company name is required'
    });
  }

  try {
    // TODO: Encrypt password in production
    const encryptedPassword = tallyPassword; // Use bcrypt or crypto.encrypt()

    await pool.query(
      `UPDATE companies
       SET tally_company_name = $1,
           tally_username = $2,
           tally_password_encrypted = $3,
           tally_auto_sync_enabled = $4,
           tally_sync_interval_minutes = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        tallyCompanyName,
        tallyUsername || null,
        encryptedPassword || null,
        autoSyncEnabled !== undefined ? autoSyncEnabled : false,
        syncIntervalMinutes || 30,
        req.companyId
      ]
    );

    console.log(`✅ Tally credentials configured for company: ${req.companyId}`);

    res.json({
      message: 'CredentialsConfigured',
      tallyCompanyName,
      autoSyncEnabled: autoSyncEnabled || false
    });

  } catch (error) {
    console.error('❌ Error configuring credentials:', error);
    res.status(500).json({
      error: 'ConfigurationFailed',
      message: error.message
    });
  }
};

/**
 * Get Tally configuration for company (Admin only)
 * GET /api/tally-sync/configuration
 */
export const getTallyConfiguration = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         tally_company_name,
         tally_username,
         tally_auto_sync_enabled,
         tally_sync_interval_minutes
       FROM companies
       WHERE id = $1`,
      [req.companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'CompanyNotFound' });
    }

    const config = result.rows[0];

    res.json({
      configured: !!config.tally_company_name,
      tallyCompanyName: config.tally_company_name,
      tallyUsername: config.tally_username,
      hasPassword: !!config.tally_password_encrypted,
      autoSyncEnabled: config.tally_auto_sync_enabled,
      syncIntervalMinutes: config.tally_sync_interval_minutes
    });

  } catch (error) {
    console.error('❌ Error fetching configuration:', error);
    res.status(500).json({
      error: 'FetchConfigFailed',
      message: error.message
    });
  }
};