// middleware/quotaCheck.js
// Fast quota checks BEFORE operations

import {
  checkUserQuota,
  checkClientQuota,
  checkServiceQuota,
  checkStorageQuota
} from "../services/usage-tracker.js";

/**
 * Check user quota before creation
 */
export const checkUserQuotaMiddleware = async (req, res, next) => {
  // Super admins bypass limits
  if (req.isSuperAdmin) {
    return next();
  }

  try {
    const quota = await checkUserQuota(req.companyId);
    
    // Log approaching limit
    if (quota.remaining <= 2) {
      console.log(`⚠️ Company ${req.companyId} approaching user limit: ${quota.remaining} remaining`);
    }

    next();
  } catch (error) {
    if (error.message.startsWith('USER_LIMIT_REACHED')) {
      return res.status(403).json({
        error: 'UserLimitReached',
        message: error.message,
        currentUsers: error.message.match(/Maximum (\d+)/)?.[1],
        upgradeUrl: '/plans/upgrade'
      });
    }
    
    console.error('❌ User quota check failed:', error);
    return res.status(500).json({ error: 'QuotaCheckFailed' });
  }
};

/**
 * Check client quota before creation
 */
export const checkClientQuotaMiddleware = async (req, res, next) => {
  // Super admins bypass limits
  if (req.isSuperAdmin) {
    return next();
  }

  try {
    const quota = await checkClientQuota(req.companyId);
    
    // Log approaching limit (if not unlimited)
    if (!quota.unlimited && quota.remaining <= 10) {
      console.log(`⚠️ Company ${req.companyId} approaching client limit: ${quota.remaining} remaining`);
    }

    next();
  } catch (error) {
    if (error.message.startsWith('CLIENT_LIMIT_REACHED')) {
      return res.status(403).json({
        error: 'ClientLimitReached',
        message: error.message,
        maxClients: error.message.match(/Maximum (\d+)/)?.[1],
        upgradeUrl: '/plans/upgrade'
      });
    }
    
    console.error('❌ Client quota check failed:', error);
    return res.status(500).json({ error: 'QuotaCheckFailed' });
  }
};

/**
 * Check service quota before creation
 */
export const checkServiceQuotaMiddleware = async (req, res, next) => {
  // Super admins bypass limits
  if (req.isSuperAdmin) {
    return next();
  }

  const clientId = req.params.clientId || req.body.clientId;
  
  if (!clientId) {
    return res.status(400).json({ error: 'ClientIdRequired' });
  }

  try {
    await checkServiceQuota(req.companyId, clientId);
    next();
  } catch (error) {
    if (error.message.startsWith('SERVICE_LIMIT_REACHED')) {
      return res.status(403).json({
        error: 'ServiceLimitReached',
        message: error.message,
        upgradeUrl: '/plans/upgrade'
      });
    }

    if (error.message.startsWith('SERVICES_NOT_ENABLED')) {
      return res.status(403).json({
        error: 'ServicesNotEnabled',
        message: error.message,
        upgradeUrl: '/plans/upgrade'
      });
    }
    
    console.error('❌ Service quota check failed:', error);
    return res.status(500).json({ error: 'QuotaCheckFailed' });
  }
};

/**
 * Check storage quota before file upload
 */
export const checkStorageQuotaMiddleware = (estimatedSizeMB = 10) => {
  return async (req, res, next) => {
    // Super admins bypass limits
    if (req.isSuperAdmin) {
      return next();
    }

    try {
      // Use actual file size if available, otherwise use estimate
      const fileSizeMB = req.file 
        ? req.file.size / (1024 * 1024)
        : estimatedSizeMB;

      await checkStorageQuota(req.companyId, fileSizeMB);
      
      // Attach size to request for later increment
      req.fileSizeMB = fileSizeMB;
      
      next();
    } catch (error) {
      if (error.message.startsWith('STORAGE_LIMIT_REACHED')) {
        return res.status(403).json({
          error: 'StorageLimitReached',
          message: error.message,
          upgradeUrl: '/plans/upgrade'
        });
      }
      
      console.error('❌ Storage quota check failed:', error);
      return res.status(500).json({ error: 'QuotaCheckFailed' });
    }
  };
};