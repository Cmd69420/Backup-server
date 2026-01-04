// controllers/integrations/lms.controller.js
// GeoTrack Backend - Handles incoming license purchase from LMS
// Supports: NEW purchases + Renewals/Upgrades

import bcrypt from "bcryptjs";
import { pool } from "../../db.js";
import crypto from "crypto";

export const handleLicensePurchase = async (req, res) => {
  console.log("\n🎯 LMS License Purchase Webhook Received");
  console.log("=" .repeat(60));

  const client = await pool.connect();

  try {
    const {
      purchaseId,
      licenseKey,
      email,
      password,
      fullName,
      companyName,
      subdomain,
      planType,
      maxUsers,
      expiryDate,
      isRenewal = false // ← NEW: Flag to indicate if this is a renewal
    } = req.body;

    console.log("📦 Payload received:");
    console.log(`   Purchase ID: ${purchaseId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Company: ${companyName}`);
    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   License Key: ${licenseKey}`);
    console.log(`   Plan: ${planType}`);
    console.log(`   Max Users: ${maxUsers}`);
    console.log(`   Expiry: ${expiryDate}`);
    console.log(`   Is Renewal: ${isRenewal}`);
    console.log(`   Password provided: ${password ? 'Yes' : 'No'}`);

    // ============================================
    // 1. VALIDATE REQUIRED FIELDS
    // ============================================
    if (!email || !companyName || !subdomain || !licenseKey) {
      console.error("❌ Missing required fields");
      return res.status(400).json({
        error: "ValidationError",
        message: "Missing required fields: email, companyName, subdomain, licenseKey"
      });
    }

    await client.query("BEGIN");

    // ============================================
    // 2. CHECK IF COMPANY ALREADY EXISTS
    // ============================================
    const existingCompany = await client.query(
      `SELECT id, name, subdomain FROM companies WHERE subdomain = $1`,
      [subdomain.toLowerCase()]
    );

    let company;
    let isNewCompany = false;

    if (existingCompany.rows.length > 0) {
      // RENEWAL/UPGRADE PATH
      company = existingCompany.rows[0];
      console.log(`\n🔄 Existing company found: ${company.name} (${company.id})`);
      
      // Update company settings
      await client.query(
  `UPDATE companies
   SET is_active = true,
       updated_at = NOW()
   WHERE id = $1`,
  [company.id]
);

      console.log(`✅ Company settings updated`);

    } else {
      // NEW PURCHASE PATH
      isNewCompany = true;
      console.log(`\n✨ Creating new company: ${companyName}`);
      
      const companyResult = await client.query(
  `INSERT INTO companies (name, subdomain, is_active)
   VALUES ($1, $2, true)
   RETURNING id, name, subdomain`,
  [
    companyName,
    subdomain.toLowerCase()
  ]
);

      company = companyResult.rows[0];
      console.log(`✅ Company created: ${company.name} (@${company.subdomain})`);
    }

    // ============================================
    // 3. UPSERT LICENSE IN COMPANY_LICENSES TABLE
    // ============================================
    console.log("\n🎫 Upserting license record...");

    const licenseResult = await client.query(
      `INSERT INTO company_licenses (company_id, license_key, plan, max_users, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id) 
       DO UPDATE SET 
         license_key = EXCLUDED.license_key,
         plan = EXCLUDED.plan,
         max_users = EXCLUDED.max_users,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()
       RETURNING id, license_key, 
         (xmax = 0) AS inserted`,
      [
        company.id,
        licenseKey,
        planType || "Standard",
        maxUsers || 1,
        expiryDate ? new Date(expiryDate) : null
      ]
    );

    const licenseOp = licenseResult.rows[0].inserted ? "created" : "updated";
    console.log(`✅ License ${licenseOp}: ${licenseKey}`);

    // ============================================
    // 4. HANDLE USER ACCOUNT
    // ============================================
    const existingUser = await client.query(
      `SELECT id, email, company_id FROM users WHERE email = $1`,
      [email]
    );

    let user;
    let userPassword = password;

    if (existingUser.rows.length > 0) {
      // USER ALREADY EXISTS
      user = existingUser.rows[0];
      console.log(`\n👤 Existing user found: ${user.email}`);
      
      // If user's company doesn't match, update it
      if (user.company_id !== company.id) {
        await client.query(
          `UPDATE users SET company_id = $1 WHERE id = $2`,
          [company.id, user.id]
        );
        console.log(`✅ User reassigned to company: ${company.name}`);
      }
      
      // Optionally update password if provided in renewal
      if (password && password.trim() !== '') {
        const hashedPassword = await bcrypt.hash(password, 10);
        await client.query(
          `UPDATE users SET password = $1 WHERE id = $2`,
          [hashedPassword, user.id]
        );
        console.log(`✅ User password updated`);
      }

    } else {
      // CREATE NEW USER
      console.log(`\n👤 Creating new user account...`);

      // Generate password if not provided
      if (!userPassword || userPassword.trim() === '') {
        userPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
        console.log(`🔐 Generated password for user`);
      }

      const hashedPassword = await bcrypt.hash(userPassword, 10);
      
      const userResult = await client.query(
        `INSERT INTO users (email, password, is_admin, company_id)
         VALUES ($1, $2, true, $3)
         RETURNING id, email`,
        [email, hashedPassword, company.id]
      );

      user = userResult.rows[0];
      console.log(`✅ User created: ${user.email} (Admin)`);

      // Create profile
      await client.query(
        `INSERT INTO profiles (user_id, full_name)
         VALUES ($1, $2)`,
        [user.id, fullName || email.split('@')[0]]
      );
      console.log(`✅ Profile created`);
    }

    await client.query("COMMIT");

    // ============================================
    // 5. SEND SUCCESS RESPONSE
    // ============================================
    console.log("\n✅ License provisioning completed successfully!");
    console.log("=" .repeat(60));

    return res.status(201).json({
      success: true,
      message: isNewCompany ? "Company and user created successfully" : "License renewed/upgraded successfully",
      isNewPurchase: isNewCompany,
      company: {
        id: company.id,
        name: company.name,
        subdomain: company.subdomain,
        url: `https://${company.subdomain}.yourdomain.com`
      },
      user: {
        id: user.id,
        email: user.email,
        isAdmin: true,
        temporaryPassword: isNewCompany ? userPassword : undefined // Only send password for new accounts
      },
      license: {
        key: licenseKey,
        plan: planType,
        maxUsers: maxUsers,
        expiryDate: expiryDate,
        operation: licenseOp
      }
    });

  } catch (error) {
    await client.query("ROLLBACK");
    
    console.error("\n❌ License provisioning failed!");
    console.error("=" .repeat(60));
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Check for duplicate license key
    if (error.code === '23505' && error.constraint?.includes('license_key')) {
      return res.status(409).json({
        error: "LicenseKeyExists",
        message: `License key "${req.body.licenseKey}" is already in use`
      });
    }

    return res.status(500).json({
      error: "ProvisioningFailed",
      message: error.message
    });

  } finally {
    client.release();
  }
}