// services/plan.service.js
// Enhanced plan service with comprehensive database-based limits

import { pool } from "../db.js";

/**
 * Get complete plan features for a company
 */
export const getCompanyPlanFeatures = async (companyId) => {
  const result = await pool.query(`
    SELECT
      c.name AS company_name,
      COALESCE(cl.plan, 'starter') AS plan_name,
      pf.*
    FROM companies c
    LEFT JOIN company_licenses cl 
      ON cl.company_id = c.id
    LEFT JOIN plan_features pf 
      ON pf.plan_name = COALESCE(cl.plan, 'starter')
    WHERE c.id = $1
  `, [companyId]);

  if (result.rows.length === 0) {
    throw new Error("Company not found");
  }

  const f = result.rows[0];

  return {
    planName: f.plan_name,
    displayName: f.display_name,
    priceINR: f.price_inr,
    companyName: f.company_name,

    limits: {
      users: {
        max: f.max_users,
        maxConcurrentSessions: f.max_concurrent_sessions
      },
      clients: {
        max: f.max_clients,
        importBatchSize: f.client_import_batch_size
      },
      storage: {
        maxGB: f.max_cloud_storage_gb
      },
      history: {
        locationDays: f.location_history_days,
        meetingDays: f.meeting_history_days,
        expenseDays: f.expense_history_days
      },
      meetings: {
        maxAttachments: f.max_meeting_attachments_per_meeting,
        attachmentMaxSizeMB: f.meeting_attachment_max_size_mb
      },
      expenses: {
        maxReceiptImages: f.max_receipt_images_per_expense,
        receiptMaxSizeMB: f.receipt_image_max_size_mb
      },
      services: {
        maxPerClient: f.max_services_per_client
      },
      api: {
        rateLimit: f.api_rate_limit_per_hour
      }
    },

    tracking: {
      gpsEnabled: f.gps_tracking_enabled,
      gpsIntervalMinutes: f.gps_tracking_interval_minutes
    },

    features: {
      clientManagementType: f.client_management_type,
      pincodeFiltering: f.pincode_filtering_enabled,
      smartPincodeFiltering: f.smart_pincode_filtering_enabled,
      advancedSearch: f.advanced_search_enabled,
      bulkOperations: f.bulk_operations_enabled,

      services: f.services_enabled,
      servicesHistory: f.services_history_enabled,

      expenses: f.expenses_enabled,

      tallySync: f.tally_sync_enabled,
      tallySyncFrequency: f.tally_sync_frequency_minutes,
      apiAccess: f.api_access_enabled,
      webhooks: f.webhook_enabled,

      basicReports: f.basic_reports_enabled,
      advancedAnalytics: f.advanced_analytics_enabled,
      customReports: f.custom_reports_enabled,
      dataExport: f.data_export_enabled,
      exportFormats: f.data_export_formats || [],

      teamManagement: f.team_management_enabled,
      roleBasedPermissions: f.role_based_permissions,

      interactiveMaps: f.interactive_maps_enabled,
      routeOptimization: f.route_optimization_enabled,

      customBranding: f.custom_branding_enabled,
      whiteLabel: f.white_label_enabled
    },

    support: {
      level: f.support_level
    }
  };
};


/**
 * Check if feature is enabled for company
 */
export const canAccessFeature = async (companyId, featureName) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  const featureMap = {
    'services': plan.features.services,
    'servicesHistory': plan.features.servicesHistory,
    'tallySync': plan.features.tallySync,
    'apiAccess': plan.features.apiAccess,
    'webhooks': plan.features.webhooks,
    'advancedAnalytics': plan.features.advancedAnalytics,
    'customReports': plan.features.customReports,
    'dataExport': plan.features.dataExport,
    'teamManagement': plan.features.teamManagement,
    'interactiveMaps': plan.features.interactiveMaps,
    'routeOptimization': plan.features.routeOptimization,
    'bulkOperations': plan.features.bulkOperations,
    'advancedSearch': plan.features.advancedSearch,
    'pincodeFiltering': plan.features.pincodeFiltering,
    'smartPincodeFiltering': plan.features.smartPincodeFiltering,
    'customBranding': plan.features.customBranding,
    'whiteLabel': plan.features.whiteLabel
  };

  return featureMap[featureName] || false;
};

/**
 * Check if company can add more users
 */
export const checkUserLimit = async (companyId) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM users WHERE company_id = $1',
    [companyId]
  );
  
  const currentUsers = parseInt(result.rows[0].count);
  const hasReachedLimit = currentUsers >= plan.limits.users.max;
  
  return {
    hasReachedLimit,
    currentUsers,
    maxUsers: plan.limits.users.max,
    remaining: Math.max(0, plan.limits.users.max - currentUsers)
  };
};

/**
 * Check if company can add more clients
 */
export const checkClientLimit = async (companyId) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  // NULL means unlimited
  if (plan.limits.clients.max === null) {
    return {
      hasReachedLimit: false,
      currentClients: await getClientCount(companyId),
      maxClients: null,
      unlimited: true
    };
  }
  
  const currentClients = await getClientCount(companyId);
  const hasReachedLimit = currentClients >= plan.limits.clients.max;
  
  return {
    hasReachedLimit,
    currentClients,
    maxClients: plan.limits.clients.max,
    remaining: Math.max(0, plan.limits.clients.max - currentClients),
    unlimited: false
  };
};

/**
 * Check if company can add more services to a client
 */
export const checkClientServiceLimit = async (companyId, clientId) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  if (!plan.features.services) {
    return {
      allowed: false,
      reason: 'Services feature not enabled in your plan'
    };
  }
  
  // NULL means unlimited
  if (plan.limits.services.maxPerClient === null) {
    return {
      allowed: true,
      currentServices: await getClientServiceCount(clientId),
      maxServices: null,
      unlimited: true
    };
  }
  
  const currentServices = await getClientServiceCount(clientId);
  const hasReachedLimit = currentServices >= plan.limits.services.maxPerClient;
  
  return {
    allowed: !hasReachedLimit,
    hasReachedLimit,
    currentServices,
    maxServices: plan.limits.services.maxPerClient,
    remaining: Math.max(0, plan.limits.services.maxPerClient - currentServices)
  };
};

/**
 * Check if meeting can have more attachments
 */
export const checkMeetingAttachmentLimit = async (companyId, meetingId) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  const result = await pool.query(
    `SELECT attachments FROM meetings WHERE id = $1 AND company_id = $2`,
    [meetingId, companyId]
  );
  
  if (result.rows.length === 0) {
    throw new Error('Meeting not found');
  }
  
  const currentAttachments = result.rows[0].attachments || [];
  const currentCount = Array.isArray(currentAttachments) ? currentAttachments.length : 0;
  const hasReachedLimit = currentCount >= plan.limits.meetings.maxAttachments;
  
  return {
    allowed: !hasReachedLimit,
    hasReachedLimit,
    currentAttachments: currentCount,
    maxAttachments: plan.limits.meetings.maxAttachments,
    maxSizeMB: plan.limits.meetings.attachmentMaxSizeMB,
    remaining: Math.max(0, plan.limits.meetings.maxAttachments - currentCount)
  };
};

/**
 * Check if expense can have more receipt images
 */
export const checkExpenseReceiptLimit = async (companyId, expenseId = null) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  let currentCount = 0;
  
  if (expenseId) {
    const result = await pool.query(
      `SELECT receipt_images FROM trip_expenses WHERE id = $1 AND company_id = $2`,
      [expenseId, companyId]
    );
    
    if (result.rows.length > 0) {
      const images = result.rows[0].receipt_images || [];
      currentCount = Array.isArray(images) ? images.length : 0;
    }
  }
  
  const hasReachedLimit = currentCount >= plan.limits.expenses.maxReceiptImages;
  
  return {
    allowed: !hasReachedLimit,
    hasReachedLimit,
    currentImages: currentCount,
    maxImages: plan.limits.expenses.maxReceiptImages,
    maxSizeMB: plan.limits.expenses.receiptMaxSizeMB,
    remaining: Math.max(0, plan.limits.expenses.maxReceiptImages - currentCount)
  };
};

/**
 * Check if client import batch size is within limits
 */
export const checkImportBatchSize = async (companyId, batchSize) => {
  const plan = await getCompanyPlanFeatures(companyId);
  
  const isWithinLimit = batchSize <= plan.limits.clients.importBatchSize;
  
  return {
    allowed: isWithinLimit,
    requestedSize: batchSize,
    maxBatchSize: plan.limits.clients.importBatchSize,
    exceededBy: isWithinLimit ? 0 : batchSize - plan.limits.clients.importBatchSize
  };
};

/**
 * Check if data should be cleaned based on retention policy
 */
export const getDataRetentionCutoffs = async (companyId) => {
  const plan = await getCompanyPlanFeatures(companyId);
  const now = new Date();
  
  return {
    locationLogs: new Date(now - plan.limits.history.locationDays * 24 * 60 * 60 * 1000),
    meetings: new Date(now - plan.limits.history.meetingDays * 24 * 60 * 60 * 1000),
    expenses: new Date(now - plan.limits.history.expenseDays * 24 * 60 * 60 * 1000)
  };
};

/**
 * Log feature usage attempt
 */
export const logFeatureUsage = async (companyId, userId, featureName, action, metadata = {}) => {
  await pool.query(
    `INSERT INTO feature_usage_log (company_id, user_id, feature_name, action, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [companyId, userId, featureName, action, JSON.stringify(metadata)]
  );
};

/**
 * Upgrade company plan
 */
export const upgradeCompanyPlan = async (companyId, newPlan) => {
  const planCheck = await pool.query(
    'SELECT 1 FROM plan_features WHERE plan_name = $1',
    [newPlan]
  );

  if (planCheck.rows.length === 0) {
    throw new Error(`Invalid plan: ${newPlan}`);
  }

  await pool.query(`
    INSERT INTO company_licenses (company_id, plan)
    VALUES ($1, $2)
    ON CONFLICT (company_id)
    DO UPDATE SET
      plan = EXCLUDED.plan,
      expires_at = NULL
  `, [companyId, newPlan]);

  console.log(`✅ Company ${companyId} upgraded to ${newPlan}`);
};


/**
 * Purchase additional user/client slots
 * POST /api/plans/purchase-slots
 */
export const purchaseSlots = async (req, res) => {
  const { additionalUsers = 0, additionalClients = 0, totalAmount } = req.body;

  /* ---------------------------
     1. Validation
  ---------------------------- */

  if (additionalUsers === 0 && additionalClients === 0) {
    return res.status(400).json({
      error: "ValidationError",
      message: "At least one slot type must be specified",
    });
  }

  if (additionalUsers < 0 || additionalClients < 0) {
    return res.status(400).json({
      error: "ValidationError",
      message: "Slot quantities cannot be negative",
    });
  }

  if (!totalAmount || totalAmount <= 0) {
    return res.status(400).json({
      error: "ValidationError",
      message: "Total amount must be provided and greater than zero",
    });
  }

  // Super admin cannot purchase slots (unlimited)
  if (req.isSuperAdmin && !req.companyId) {
    return res.status(400).json({
      error: "NoCompanyContext",
      message: "Super admins cannot purchase slots",
    });
  }

  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    /* ---------------------------
       2. Fetch License + Plan Limits
       (Aliased properly)
    ---------------------------- */

    const licenseResult = await dbClient.query(
      `
      SELECT 
        cl.plan,

        cl.max_users   AS license_max_users,
        cl.max_clients AS license_max_clients,

        pf.max_users   AS plan_max_users,
        pf.max_clients AS plan_max_clients

      FROM company_licenses cl
      LEFT JOIN plan_features pf 
        ON pf.plan_name = cl.plan

      WHERE cl.company_id = $1
      `,
      [req.companyId]
    );

    if (licenseResult.rows.length === 0) {
      await dbClient.query("ROLLBACK");
      return res.status(404).json({
        error: "LicenseNotFound",
        message: "No active license found for your company",
      });
    }

    const license = licenseResult.rows[0];

    /* ---------------------------
       3. Resolve Current Limits
       License override > Plan default
    ---------------------------- */

    const currentMaxUsers =
      license.license_max_users ?? license.plan_max_users;

    const currentMaxClients =
      license.license_max_clients ?? license.plan_max_clients;

    /* ---------------------------
       4. Calculate New Limits
       NULL means unlimited
    ---------------------------- */

    const newMaxUsers =
      currentMaxUsers === null
        ? null
        : currentMaxUsers + additionalUsers;

    const newMaxClients =
      currentMaxClients === null
        ? null
        : currentMaxClients + additionalClients;

    /* ---------------------------
       5. Update License Overrides
    ---------------------------- */

    await dbClient.query(
      `
      UPDATE company_licenses
      SET max_users = $1,
          max_clients = $2
      WHERE company_id = $3
      `,
      [newMaxUsers, newMaxClients, req.companyId]
    );

    /* ---------------------------
       6. Record Billing Transaction
    ---------------------------- */

    await dbClient.query(
      `
      INSERT INTO billing_transactions
        (company_id, transaction_type, amount, currency, payment_status, metadata)
      VALUES
        ($1, $2, $3, 'INR', 'completed', $4)
      `,
      [
        req.companyId,
        "SLOT_EXPANSION",
        totalAmount,
        JSON.stringify({
          additionalUsers,
          additionalClients,

          previousMaxUsers: currentMaxUsers,
          previousMaxClients: currentMaxClients,

          newMaxUsers,
          newMaxClients,

          purchasedBy: req.user?.id,
          purchasedAt: new Date().toISOString(),
        }),
      ]
    );

    await dbClient.query("COMMIT");

    console.log(
      `✅ Slot expansion successful for company ${req.companyId}`,
      {
        additionalUsers,
        additionalClients,
        newMaxUsers,
        newMaxClients,
      }
    );

    /* ---------------------------
       7. Response
    ---------------------------- */

    return res.json({
      message: "SlotsPurchasedSuccessfully",
      purchase: {
        additionalUsers,
        additionalClients,
        totalAmount,
        currency: "INR",
      },
      limits: {
        previous: {
          maxUsers: currentMaxUsers,
          maxClients: currentMaxClients,
        },
        updated: {
          maxUsers: newMaxUsers,
          maxClients: newMaxClients,
        },
      },
    });
  } catch (error) {
    await dbClient.query("ROLLBACK");

    console.error("❌ Slot purchase failed:", error);

    return res.status(500).json({
      error: "PurchaseFailed",
      message: error.message,
    });
  } finally {
    dbClient.release();
  }
};



/**
 * Get all available plans (for pricing page)
 */
export const getAllPlans = async () => {
  const result = await pool.query(`
    SELECT * FROM plan_features ORDER BY price_inr ASC
  `);
  
  return result.rows;
};

/**
 * Get current company usage statistics
 */
export const getCompanyUsage = async (companyId) => {
  const [users, clients, services, meetings, expenses, locationLogs, storage] = await Promise.all([
    pool.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1', [companyId]),
    pool.query('SELECT COUNT(*) as count FROM clients WHERE company_id = $1', [companyId]),
    pool.query('SELECT COUNT(*) as count FROM client_services WHERE company_id = $1', [companyId]),
    pool.query('SELECT COUNT(*) as count FROM meetings WHERE company_id = $1', [companyId]),
    pool.query('SELECT COUNT(*) as count FROM trip_expenses WHERE company_id = $1', [companyId]),
    pool.query('SELECT COUNT(*) as count FROM location_logs WHERE company_id = $1', [companyId]),
    pool.query('SELECT storage_used_mb FROM company_usage_stats WHERE company_id = $1', [companyId])
  ]);
  
  return {
    users: parseInt(users.rows[0].count),
    clients: parseInt(clients.rows[0].count),
    services: parseInt(services.rows[0].count),
    meetings: parseInt(meetings.rows[0].count),
    expenses: parseInt(expenses.rows[0].count),
    locationLogs: parseInt(locationLogs.rows[0].count),
    storage_used_mb: parseFloat(storage.rows[0]?.storage_used_mb || 0)
  };
};
// Helper functions
async function getClientCount(companyId) {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM clients WHERE company_id = $1',
    [companyId]
  );
  return parseInt(result.rows[0].count);
}

async function getClientServiceCount(clientId) {
  const result = await pool.query(
    'SELECT COUNT(*) as count FROM client_services WHERE client_id = $1',
    [clientId]
  );
  return parseInt(result.rows[0].count);
}