// services/usage-tracker.js
// Real-time quota tracking with atomic counter operations
// ✅ UPDATED: Now syncs with License Management System (LMS)

import { pool } from "../db.js";
import {
  incrementLMSUserCount,
  decrementLMSUserCount,
  incrementLMSClientCount,
  decrementLMSClientCount,
  incrementLMSServiceCount,
  decrementLMSServiceCount,
  incrementLMSStorageUsed
} from "./lms-client.service.js";

/**
 * Get current usage stats for a company
 */
export const getCompanyUsageStats = async (companyId) => {
  const result = await pool.query(
    `SELECT * FROM company_usage_stats WHERE company_id = $1`,
    [companyId]
  );

  if (result.rows.length === 0) {
    // Initialize if not exists
    await initializeUsageStats(companyId);
    return getCompanyUsageStats(companyId);
  }

  return result.rows[0];
};

/**
 * Get plan limits for a company
 */
export const getCompanyLimits = async (companyId) => {
  const result = await pool.query(
    `SELECT 
       pf.max_users,
       pf.max_clients,
       pf.max_services_per_client,
       pf.max_cloud_storage_gb,
       COALESCE(cl.plan, 'starter') as plan_name
     FROM companies c
     LEFT JOIN company_licenses cl ON cl.company_id = c.id
     LEFT JOIN plan_features pf ON pf.plan_name = COALESCE(cl.plan, 'starter')
     WHERE c.id = $1`,
    [companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Company not found');
  }

  return result.rows[0];
};

// ============================================
// USER QUOTA FUNCTIONS
// ============================================

export const checkUserQuota = async (companyId) => {
  const [stats, limits] = await Promise.all([
    getCompanyUsageStats(companyId),
    getCompanyLimits(companyId)
  ]);

  if (stats.current_users >= limits.max_users) {
    throw new Error(`USER_LIMIT_REACHED: Maximum ${limits.max_users} users allowed in ${limits.plan_name} plan`);
  }

  return {
    current: stats.current_users,
    max: limits.max_users,
    remaining: limits.max_users - stats.current_users
  };
};

// ✅ SIMPLIFIED: No userId parameter needed - LMS uses license owner
export const incrementUserCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_users = current_users + 1,
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_users`,
    [companyId]
  );

  console.log(`📊 User count incremented for company ${companyId}: ${result.rows[0].current_users}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  incrementLMSUserCount(companyId).catch(err => {
    console.error('⚠️ LMS user increment failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_users;
};

// ✅ SIMPLIFIED: No userId parameter needed
export const decrementUserCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_users = GREATEST(0, current_users - 1),
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_users`,
    [companyId]
  );

  console.log(`📊 User count decremented for company ${companyId}: ${result.rows[0].current_users}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  decrementLMSUserCount(companyId).catch(err => {
    console.error('⚠️ LMS user decrement failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_users;
};

// ============================================
// CLIENT QUOTA FUNCTIONS
// ============================================

export const checkClientQuota = async (companyId) => {
  const [stats, limits] = await Promise.all([
    getCompanyUsageStats(companyId),
    getCompanyLimits(companyId)
  ]);

  // NULL means unlimited
  if (limits.max_clients === null) {
    return {
      current: stats.current_clients,
      max: null,
      unlimited: true
    };
  }

  if (stats.current_clients >= limits.max_clients) {
    throw new Error(`CLIENT_LIMIT_REACHED: Maximum ${limits.max_clients} clients allowed in ${limits.plan_name} plan`);
  }

  return {
    current: stats.current_clients,
    max: limits.max_clients,
    remaining: limits.max_clients - stats.current_clients
  };
};

// ✅ SIMPLIFIED: No userId parameter needed
export const incrementClientCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_clients = current_clients + 1,
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_clients`,
    [companyId]
  );

  console.log(`📊 Client count incremented for company ${companyId}: ${result.rows[0].current_clients}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  incrementLMSClientCount(companyId).catch(err => {
    console.error('⚠️ LMS client increment failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_clients;
};

// ✅ SIMPLIFIED: No userId parameter needed
export const decrementClientCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_clients = GREATEST(0, current_clients - 1),
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_clients`,
    [companyId]
  );

  console.log(`📊 Client count decremented for company ${companyId}: ${result.rows[0].current_clients}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  decrementLMSClientCount(companyId).catch(err => {
    console.error('⚠️ LMS client decrement failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_clients;
};

// ============================================
// SERVICE QUOTA FUNCTIONS
// ============================================

export const checkServiceQuota = async (companyId, clientId) => {
  const [stats, limits] = await Promise.all([
    getCompanyUsageStats(companyId),
    getCompanyLimits(companyId)
  ]);

  // Check if services feature is enabled
  const serviceCheck = await pool.query(
    `SELECT pf.services_enabled 
     FROM company_licenses cl
     JOIN plan_features pf ON pf.plan_name = cl.plan
     WHERE cl.company_id = $1`,
    [companyId]
  );

  if (serviceCheck.rows.length > 0 && !serviceCheck.rows[0].services_enabled) {
    throw new Error(`SERVICES_NOT_ENABLED: Services feature not available in ${limits.plan_name} plan`);
  }

  // Check per-client service limit
  if (limits.max_services_per_client !== null) {
    const clientServiceCount = await pool.query(
      `SELECT COUNT(*) as count 
       FROM client_services 
       WHERE client_id = $1 AND status = 'active'`,
      [clientId]
    );

    const currentServices = parseInt(clientServiceCount.rows[0].count);

    if (currentServices >= limits.max_services_per_client) {
      throw new Error(`SERVICE_LIMIT_REACHED: Maximum ${limits.max_services_per_client} services per client in ${limits.plan_name} plan`);
    }
  }

  return {
    current: stats.current_active_services,
    perClientLimit: limits.max_services_per_client
  };
};

// ✅ SIMPLIFIED: No userId parameter needed
export const incrementServiceCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_active_services = current_active_services + 1,
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_active_services`,
    [companyId]
  );

  console.log(`📊 Service count incremented for company ${companyId}: ${result.rows[0].current_active_services}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  incrementLMSServiceCount(companyId).catch(err => {
    console.error('⚠️ LMS service increment failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_active_services;
};

// ✅ SIMPLIFIED: No userId parameter needed
export const decrementServiceCount = async (companyId, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET current_active_services = GREATEST(0, current_active_services - 1),
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING current_active_services`,
    [companyId]
  );

  console.log(`📊 Service count decremented for company ${companyId}: ${result.rows[0].current_active_services}`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  decrementLMSServiceCount(companyId).catch(err => {
    console.error('⚠️ LMS service decrement failed (non-critical):', err.message);
  });
  
  return result.rows[0].current_active_services;
};

// ============================================
// STORAGE QUOTA FUNCTIONS
// ============================================

export const checkStorageQuota = async (companyId, additionalMB) => {
  const [stats, limits] = await Promise.all([
    getCompanyUsageStats(companyId),
    getCompanyLimits(companyId)
  ]);

  const maxStorageMB = limits.max_cloud_storage_gb * 1024;
  const newTotal = stats.storage_used_mb + additionalMB;

  if (newTotal > maxStorageMB) {
    throw new Error(`STORAGE_LIMIT_REACHED: Maximum ${limits.max_cloud_storage_gb}GB storage allowed in ${limits.plan_name} plan`);
  }

  return {
    current: stats.storage_used_mb,
    max: maxStorageMB,
    remaining: maxStorageMB - stats.storage_used_mb
  };
};

// ✅ SIMPLIFIED: No userId parameter needed
export const incrementStorageUsed = async (companyId, sizeMB, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET storage_used_mb = storage_used_mb + $2,
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING storage_used_mb`,
    [companyId, sizeMB]
  );

  console.log(`📊 Storage incremented for company ${companyId}: +${sizeMB}MB = ${result.rows[0].storage_used_mb}MB`);
  
  // ✅ Send to LMS using stored license owner ID (non-blocking)
  incrementLMSStorageUsed(companyId, sizeMB).catch(err => {
    console.error('⚠️ LMS storage increment failed (non-critical):', err.message);
  });
  
  return result.rows[0].storage_used_mb;
};

export const decrementStorageUsed = async (companyId, sizeMB, transaction = null) => {
  const client = transaction || pool;
  
  const result = await client.query(
    `UPDATE company_usage_stats 
     SET storage_used_mb = GREATEST(0, storage_used_mb - $2),
         last_calculated_at = NOW()
     WHERE company_id = $1
     RETURNING storage_used_mb`,
    [companyId, sizeMB]
  );

  console.log(`📊 Storage decremented for company ${companyId}: -${sizeMB}MB = ${result.rows[0].storage_used_mb}MB`);
  return result.rows[0].storage_used_mb;
};

// ============================================
// INITIALIZATION & RECONCILIATION
// ============================================

export const initializeUsageStats = async (companyId) => {
  await pool.query(
    `INSERT INTO company_usage_stats (company_id)
     VALUES ($1)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId]
  );
  
  console.log(`✅ Initialized usage stats for company ${companyId}`);
};

export const reconcileCompanyUsage = async (companyId) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Count actual users
    const userCount = await client.query(
      'SELECT COUNT(*) as count FROM users WHERE company_id = $1',
      [companyId]
    );

    // Count actual clients
    const clientCount = await client.query(
      'SELECT COUNT(*) as count FROM clients WHERE company_id = $1',
      [companyId]
    );

    // Count active services
    const serviceCount = await client.query(
      `SELECT COUNT(*) as count 
       FROM client_services 
       WHERE company_id = $1 AND status = 'active'`,
      [companyId]
    );

    // Calculate storage (placeholder - implement based on your storage system)
    const storageUsed = 0; // TODO: Calculate actual storage

    // Update stats
    await client.query(
      `UPDATE company_usage_stats 
       SET current_users = $2,
           current_clients = $3,
           current_active_services = $4,
           storage_used_mb = $5,
           last_calculated_at = NOW()
       WHERE company_id = $1`,
      [
        companyId,
        parseInt(userCount.rows[0].count),
        parseInt(clientCount.rows[0].count),
        parseInt(serviceCount.rows[0].count),
        storageUsed
      ]
    );

    await client.query('COMMIT');

    console.log(`✅ Reconciled usage for company ${companyId}`);

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const reconcileAllCompanies = async () => {
  const result = await pool.query('SELECT id FROM companies WHERE is_active = true');
  
  console.log(`🔄 Starting reconciliation for ${result.rows.length} companies...`);
  
  for (const company of result.rows) {
    try {
      await reconcileCompanyUsage(company.id);
    } catch (error) {
      console.error(`❌ Reconciliation failed for company ${company.id}:`, error.message);
    }
  }
  
  console.log(`✅ Reconciliation complete`);
};