import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../db.js";

/**
 * ======================================================
 * MIDDLEWARE: Verify LMS Signature
 * ======================================================
 */
export const verifyLmsSignature = (req, res, next) => {
  const secret = process.env.LICENSE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("❌ LICENSE_WEBHOOK_SECRET is missing");
    return res.status(500).json({
      error: "ServerMisconfigured",
      message: "LICENSE_WEBHOOK_SECRET not set",
    });
  }

  const signature = req.headers["x-lms-signature"];
  if (!signature) {
    return res.status(401).json({ error: "MissingSignature" });
  }

  const payload =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body);

  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  if (signature !== expected) {
    console.error("❌ Signature mismatch:", { expected, received: signature });
    return res.status(401).json({ error: "InvalidSignature" });
  }

  next();
};

/**
 * ======================================================
 * CONTROLLER: Handle License Purchase from LMS
 * ======================================================
 */
export const handleLicensePurchase = async (req, res) => {
  console.log("🚀 LMS WEBHOOK HIT");
  console.log("📦 Payload:", JSON.stringify(req.body, null, 2));

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
  } = req.body;

  // ============================================
  // VALIDATION
  // ============================================
  if (!email || !password || !companyName || !subdomain || !licenseKey) {
    return res.status(400).json({
      error: "MissingRequiredFields",
      message: "email, password, companyName, subdomain, and licenseKey are required",
      received: {
        email: !!email,
        password: !!password,
        companyName: !!companyName,
        subdomain: !!subdomain,
        licenseKey: !!licenseKey
      }
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ============================================
    // 1. IDEMPOTENCY CHECK
    // ============================================
    const existingLicense = await client.query(
      "SELECT company_id FROM company_licenses WHERE license_key = $1",
      [licenseKey]
    );

    if (existingLicense.rows.length > 0) {
      await client.query("ROLLBACK");
      console.log(`ℹ️ License ${licenseKey} already processed`);
      
      const companyInfo = await client.query(
        "SELECT id, name, subdomain FROM companies WHERE id = $1",
        [existingLicense.rows[0].company_id]
      );
      
      return res.json({
        status: "AlreadyProcessed",
        company: companyInfo.rows[0],
        message: "This license has already been activated"
      });
    }

    // ============================================
    // 2. CREATE OR GET COMPANY
    // ============================================
    let companyId;
    let companyCreated = false;
    
    const cleanSubdomain = subdomain
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 30);

    const companyCheck = await client.query(
      "SELECT id, name FROM companies WHERE subdomain = $1",
      [cleanSubdomain]
    );

    if (companyCheck.rows.length > 0) {
      // Company exists - use it
      companyId = companyCheck.rows[0].id;
      console.log(`📦 Using existing company: ${companyCheck.rows[0].name} (ID: ${companyId})`);
    } else {
      // Create new company
      const companyRes = await client.query(
        `INSERT INTO companies (name, subdomain, is_active, settings, created_at, updated_at)
         VALUES ($1, $2, true, $3, NOW(), NOW())
         RETURNING id, name, subdomain`,
        [
          companyName,
          cleanSubdomain,
          JSON.stringify({ 
            plan: planType,
            source: 'lms',
            purchaseId: purchaseId
          })
        ]
      );

      companyId = companyRes.rows[0].id;
      companyCreated = true;
      console.log(`✨ Created company: ${companyRes.rows[0].name} (ID: ${companyId})`);
    }

    // ============================================
    // 3. CREATE OR UPDATE USER
    // ============================================
    let userId;
    let userCreated = false;
    
    const cleanEmail = email.toLowerCase().trim();

    const userCheck = await client.query(
      "SELECT id, email, company_id, is_admin FROM users WHERE email = $1",
      [cleanEmail]
    );

    if (userCheck.rows.length > 0) {
      // User exists
      userId = userCheck.rows[0].id;
      const existingCompanyId = userCheck.rows[0].company_id;
      
      // Update company if different or null
      if (!existingCompanyId || existingCompanyId !== companyId) {
        await client.query(
          `UPDATE users 
           SET company_id = $1, 
               is_admin = true,
               auth_source = 'lms'
           WHERE id = $2`,
          [companyId, userId]
        );
        console.log(`🔄 Updated user ${cleanEmail}: assigned to company ${companyId}, promoted to admin`);
      } else {
        console.log(`👤 Using existing user: ${cleanEmail} (ID: ${userId})`);
      }
      
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(password, 10);

      const userRes = await client.query(
        `INSERT INTO users (
          email,
          password,
          is_admin,
          is_super_admin,
          company_id,
          auth_source,
          created_at
        )
        VALUES ($1, $2, true, false, $3, 'lms', NOW())
        RETURNING id, email`,
        [cleanEmail, hashedPassword, companyId]
      );

      userId = userRes.rows[0].id;
      userCreated = true;
      console.log(`👤 Created admin user: ${cleanEmail} (ID: ${userId})`);

      // Create profile
      const profileName = fullName || cleanEmail.split('@')[0];
      await client.query(
        `INSERT INTO profiles (user_id, full_name, created_at)
         VALUES ($1, $2, NOW())`,
        [userId, profileName]
      );
      console.log(`📝 Created profile for user ${userId}`);
    }

    // ============================================
    // 4. STORE LICENSE
    // ============================================
    const expiresAt = expiryDate ? new Date(expiryDate) : null;
    
    const licenseRes = await client.query(
      `INSERT INTO company_licenses (
        company_id,
        license_key,
        plan,
        max_users,
        expires_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, license_key, plan`,
      [
        companyId,
        licenseKey,
        planType || 'Standard',
        maxUsers || 1,
        expiresAt
      ]
    );

    const licenseId = licenseRes.rows[0].id;
    console.log(`📜 License created: ${licenseKey} (ID: ${licenseId})`);

    await client.query("COMMIT");

    // ============================================
    // 5. SUCCESS RESPONSE
    // ============================================
    console.log("✅ PROVISIONING SUCCESSFUL");
    
    return res.status(201).json({
      status: "PROVISIONED",
      success: true,
      company: {
        id: companyId,
        name: companyName,
        subdomain: cleanSubdomain,
        created: companyCreated
      },
      user: {
        id: userId,
        email: cleanEmail,
        created: userCreated,
        isAdmin: true
      },
      license: {
        id: licenseId,
        key: licenseKey,
        plan: planType,
        maxUsers: maxUsers || 1,
        expiresAt: expiresAt ? expiresAt.toISOString() : null
      },
      loginUrl: `https://your-geotrack-domain.com/auth/login`,
      message: `Company ${companyName} has been provisioned successfully`
    });

  } catch (err) {
    await client.query("ROLLBACK");
    
    console.error("❌ LMS PROVISIONING ERROR:", {
      message: err.message,
      stack: err.stack,
      code: err.code
    });

    return res.status(500).json({
      error: "ProvisioningFailed",
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: err.stack,
        code: err.code
      } : undefined
    });
    
  } finally {
    client.release();
  }
};