// controllers/payment.controller.js
// Get LMS user ID for payment processing

import { pool } from "../db.js";

/**
 * Get lms_user_id for a user's company
 * This is what the payment API needs!
 * 
 * POST /api/payment/get-lms-user-id
 * Body: { email }
 */
export const getLmsUserId = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Email is required"
      });
    }

    console.log(`🔍 Looking up lms_user_id for: ${email}`);

    // Find user by email
    const userResult = await pool.query(
      `SELECT id, email, company_id FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: "UserNotFound",
        message: "User not found"
      });
    }

    const user = userResult.rows[0];

    if (!user.company_id) {
      return res.status(404).json({
        error: "NoCompany",
        message: "User is not assigned to any company"
      });
    }

    // Get company license with lms_user_id
    const licenseResult = await pool.query(
      `SELECT 
         cl.license_key,
         cl.lms_user_id,
         cl.lms_license_id,
         cl.plan,
         c.name as company_name
       FROM company_licenses cl
       JOIN companies c ON c.id = cl.company_id
       WHERE cl.company_id = $1`,
      [user.company_id]
    );

    if (licenseResult.rows.length === 0) {
      return res.status(404).json({
        error: "NoLicense",
        message: "No license found for this company"
      });
    }

    const license = licenseResult.rows[0];

    if (!license.lms_user_id) {
      console.error(`❌ No lms_user_id found for ${email}`);
      console.error(`   Company: ${license.company_name}`);
      console.error(`   License Key: ${license.license_key}`);
      
      return res.status(404).json({
        error: "NoLmsUserId",
        message: "lms_user_id not set for this license. Contact support.",
        companyName: license.company_name
      });
    }

    console.log(`✅ Found lms_user_id for ${email}: ${license.lms_user_id}`);

    res.json({
      lms_user_id: license.lms_user_id,
      lms_license_id: license.lms_license_id,
      license_key: license.license_key,
      plan: license.plan,
      company_name: license.company_name
    });

  } catch (error) {
    console.error("❌ Error getting lms_user_id:", error);
    res.status(500).json({
      error: "ServerError",
      message: "Failed to get lms_user_id"
    });
  }
};