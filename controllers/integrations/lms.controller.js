// controllers/integrations/lms.controller.js
// GeoTrack Backend - Handles incoming license purchase from LMS

import bcrypt from "bcryptjs";
import { pool } from "../../db.js";
import crypto from "crypto";

export const handleLicensePurchase = async (req, res) => {
  console.log("\n🎯 LMS License Purchase Webhook Received");
  console.log("=" .repeat(60));

  try {
    const {
      purchaseId,
      licenseKey,
      email,
      password, // ← Optional now
      fullName,
      companyName,
      subdomain,
      planType,
      maxUsers,
      expiryDate
    } = req.body;

    console.log("📦 Payload received:");
    console.log(`   Purchase ID: ${purchaseId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Company: ${companyName}`);
    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   Password provided: ${password ? 'Yes' : 'No (will generate)'}`);

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

    // ============================================
    // 2. GENERATE PASSWORD IF NOT PROVIDED
    // ============================================
    let userPassword = password;
    
    if (!userPassword || userPassword.trim() === '') {
      // Generate a secure random password
      userPassword = crypto.randomBytes(12).toString('base64').slice(0, 16);
      console.log(`🔐 Generated password for user (not provided in payload)`);
    } else {
      console.log(`🔐 Using password from payload`);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(userPassword, 10);

    // ============================================
    // 3. CREATE COMPANY
    // ============================================
    console.log("\n🏢 Creating company...");

    const companyResult = await pool.query(
      `INSERT INTO companies (name, subdomain, is_active, settings)
       VALUES ($1, $2, true, $3)
       RETURNING id, name, subdomain`,
      [
        companyName,
        subdomain.toLowerCase(),
        JSON.stringify({
          plan: planType || "Standard",
          maxUsers: maxUsers || 1,
          licenseKey: licenseKey,
          purchaseId: purchaseId,
          expiryDate: expiryDate
        })
      ]
    );

    const company = companyResult.rows[0];
    console.log(`✅ Company created: ${company.name} (@${company.subdomain})`);

    // ============================================
    // 4. CREATE USER
    // ============================================
    console.log("\n👤 Creating user account...");

    const userResult = await pool.query(
      `INSERT INTO users (email, password, is_admin, company_id)
       VALUES ($1, $2, true, $3)
       RETURNING id, email`,
      [email, hashedPassword, company.id]
    );

    const user = userResult.rows[0];
    console.log(`✅ User created: ${user.email} (Admin)`);

    // ============================================
    // 5. CREATE USER PROFILE
    // ============================================
    await pool.query(
      `INSERT INTO profiles (user_id, full_name)
       VALUES ($1, $2)`,
      [user.id, fullName || email.split('@')[0]]
    );

    console.log(`✅ Profile created`);

    // ============================================
    // 6. SEND SUCCESS RESPONSE
    // ============================================
    console.log("\n✅ License provisioning completed successfully!");
    console.log("=" .repeat(60));

    return res.status(201).json({
      success: true,
      message: "Company and user created successfully",
      company: {
        id: company.id,
        name: company.name,
        subdomain: company.subdomain,
        url: `https://${company.subdomain}.yourdomain.com` // Update with your actual domain
      },
      user: {
        id: user.id,
        email: user.email,
        isAdmin: true,
        // ⚠️ ONLY send password in response if you want LMS to email it
        // Otherwise, you can send it via your own email system
        temporaryPassword: userPassword // Send back to LMS for emailing
      },
      license: {
        key: licenseKey,
        plan: planType,
        maxUsers: maxUsers,
        expiryDate: expiryDate
      }
    });

  } catch (error) {
    console.error("\n❌ License provisioning failed!");
    console.error("=" .repeat(60));
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Check for duplicate company subdomain
    if (error.code === '23505' && error.constraint?.includes('subdomain')) {
      return res.status(409).json({
        error: "SubdomainExists",
        message: `Company with subdomain "${req.body.subdomain}" already exists`
      });
    }

    // Check for duplicate email
    if (error.code === '23505' && error.constraint?.includes('email')) {
      return res.status(409).json({
        error: "EmailExists",
        message: `User with email "${req.body.email}" already exists`
      });
    }

    return res.status(500).json({
      error: "ProvisioningFailed",
      message: error.message
    });
  }
};