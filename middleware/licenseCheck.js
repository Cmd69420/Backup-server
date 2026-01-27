import { pool } from "../db.js";

/**
 * Check if company license is valid - BLOCKS ALL ACCESS IF EXPIRED
 * Apply this middleware to EVERY protected route
 */
export const checkCompanyLicense = async (req, res, next) => {
  // ✅ Super admins bypass ALL checks
  if (req.user?.isSuperAdmin) {
    return next();
  }

  // ✅ Must have company context
  if (!req.companyId) {
    return res.status(403).json({
      error: 'NoCompanyAssigned',
      message: 'User not assigned to any company'
    });
  }

  try {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.name,
        c.is_active,
        cl.plan,
        cl.expires_at,
        cl.license_key,
        CASE 
          WHEN cl.expires_at IS NULL THEN false
          WHEN cl.expires_at < NOW() THEN true
          ELSE false
        END as is_expired,
        CASE 
          WHEN cl.expires_at IS NULL THEN NULL
          WHEN cl.expires_at < NOW() THEN 0
          ELSE EXTRACT(DAY FROM cl.expires_at - NOW())
        END as days_until_expiry
      FROM companies c
      LEFT JOIN company_licenses cl ON cl.company_id = c.id
      WHERE c.id = $1
    `, [req.companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'CompanyNotFound',
        message: 'Company does not exist'
      });
    }

    const company = result.rows[0];

    // ============================================
    // CHECK 1: Company must be active
    // ============================================
    if (!company.is_active) {
      console.log(`🚫 BLOCKED: Company ${company.name} is deactivated`);
      
      return res.status(403).json({
        error: 'COMPANY_DEACTIVATED',
        message: 'Your company account has been deactivated. Contact support.',
        companyName: company.name
      });
    }

    // ============================================
    // CHECK 2: Must have a license
    // ============================================
    if (!company.license_key) {
      console.log(`🚫 BLOCKED: Company ${company.name} has no license`);
      
      return res.status(403).json({
        error: 'NO_LICENSE',
        message: 'No active license found. Please purchase a license to continue.',
        companyName: company.name,
        purchaseUrl: 'https://license-system.onrender.com'
      });
    }

    // ============================================
    // CHECK 3: License must not be expired
    // ============================================
    if (company.is_expired) {
      console.log(`🚫 BLOCKED: License expired for ${company.name} on ${company.expires_at}`);
      
      return res.status(403).json({
        error: 'LICENSE_EXPIRED',
        message: 'Your license has expired. Please renew to regain access.',
        companyName: company.name,
        plan: company.plan,
        expiredOn: company.expires_at,
        daysExpired: Math.abs(Math.floor(company.days_until_expiry || 0)),
        renewUrl: 'https://license-system.onrender.com',
        contactSupport: true
      });
    }

    // ============================================
    // WARNING: License expiring soon (7 days)
    // ============================================
    if (company.days_until_expiry !== null && company.days_until_expiry <= 7) {
      console.log(`⚠️ License expiring in ${Math.floor(company.days_until_expiry)} days for ${company.name}`);
      
      // Add warning headers for frontend
      res.set('X-License-Warning', 'expiring-soon');
      res.set('X-Days-Until-Expiry', Math.floor(company.days_until_expiry).toString());
    }

    // ✅ LICENSE VALID - Allow access
    req.licenseInfo = {
      plan: company.plan,
      expiresAt: company.expires_at,
      daysRemaining: company.days_until_expiry ? Math.floor(company.days_until_expiry) : null,
      isExpiringSoon: company.days_until_expiry !== null && company.days_until_expiry <= 7
    };

    next();

  } catch (error) {
    console.error('❌ License check error:', error);
    return res.status(500).json({
      error: 'LicenseCheckFailed',
      message: 'Failed to verify license'
    });
  }
};