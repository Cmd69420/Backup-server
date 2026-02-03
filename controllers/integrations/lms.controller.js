// controllers/integrations/lms.controller.js - UPDATED
// Now captures and stores transaction history

import bcrypt from "bcryptjs";
import { pool } from "../../db.js";
import crypto from "crypto";
import { extractDomain, isGenericEmailDomain } from "../../services/emailDomain.service.js";

export const handleLicensePurchase = async (req, res) => {
  console.log("\n🎯 LMS License Purchase Webhook Received");
  console.log("=" .repeat(60));

  const client = await pool.connect();

  try {
    const {
      purchaseId,
      licenseKey,
      lmsLicenseId,
      email,
      password,
      fullName,
      companyName,
      subdomain,
      planType,
      maxUsers,
      maxClients,
      storagePerUser,
      apiCallsPerUser,
      expiryDate,
      startDate,
      validityDays,
      billingCycle,
      originalAmount,
      creditApplied,
      subtotal,
      gstAmount,
      totalPaid,
      paymentId,
      orderId,
      oldPlanName,
      oldLicenseKey,
      isRenewal = false,
      isUpgrade = false,
      lmsUserId
    } = req.body;

    console.log("📦 Payload received:");
    console.log(`   Purchase ID: ${purchaseId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Company: ${companyName}`);
    console.log(`   Subdomain: ${subdomain}`);
    console.log(`   License Key: ${licenseKey}`);
    console.log(`   LMS License ID: ${lmsLicenseId || 'NOT PROVIDED'}`);
    console.log(`   LMS User ID: ${lmsUserId || 'NOT PROVIDED'}`);
    console.log(`   Plan: ${planType}`);
    console.log(`   Billing Cycle: ${billingCycle || 'NOT PROVIDED'}`);
    console.log(`   Max Users: ${maxUsers}`);
    console.log(`   Total Paid: ${totalPaid || 'NOT PROVIDED'}`);
    console.log(`   Expiry: ${expiryDate}`);
    console.log(`   Is Renewal: ${isRenewal}`);
    console.log(`   Is Upgrade: ${isUpgrade}`);
    console.log(`   Password provided: ${password ? 'Yes' : 'No'}`);

    // Validate required fields
    if (!email || !companyName || !subdomain || !licenseKey) {
      console.error("❌ Missing required fields");
      return res.status(400).json({
        error: "ValidationError",
        message: "Missing required fields: email, companyName, subdomain, licenseKey"
      });
    }

    // ✅ CRITICAL: Warn if lmsLicenseId is missing
    if (!lmsLicenseId) {
      console.error("⚠️⚠️⚠️ CRITICAL WARNING ⚠️⚠️⚠️");
      console.error("lmsLicenseId (MongoDB _id) not provided!");
      console.error("Heartbeat syncing will NOT work without this!");
      console.error("Your LMS webhook MUST send the license._id field");
    }

    // Extract email domain from admin email
    let emailDomain = null;
    try {
      const extractedDomain = extractDomain(email);
      if (!isGenericEmailDomain(email)) {
        emailDomain = extractedDomain;
        console.log(`   📧 Email domain extracted: ${emailDomain}`);
      } else {
        console.log(`   ⚠️ Generic email detected (${extractedDomain}), not setting email_domain`);
      }
    } catch (error) {
      console.log(`   ⚠️ Could not extract email domain: ${error.message}`);
    }

    await client.query("BEGIN");

    // Check if company already exists
    const existingCompany = await client.query(
      `SELECT id, name, subdomain, email_domain FROM companies WHERE subdomain = $1`,
      [subdomain.toLowerCase()]
    );

    let company;
    let isNewCompany = false;

    if (existingCompany.rows.length > 0) {
      // RENEWAL/UPGRADE PATH
      company = existingCompany.rows[0];
      console.log(`\n🔄 Existing company found: ${company.name} (${company.id})`);
      
      if (!company.email_domain && emailDomain) {
        await client.query(
          `UPDATE companies
           SET email_domain = $1, is_active = true, updated_at = NOW()
           WHERE id = $2`,
          [emailDomain, company.id]
        );
        console.log(`   📧 Email domain set: ${emailDomain}`);
      } else {
        await client.query(
          `UPDATE companies
           SET is_active = true, updated_at = NOW()
           WHERE id = $1`,
          [company.id]
        );
      }
      console.log(`✅ Company settings updated`);

    } else {
      // NEW PURCHASE PATH
      isNewCompany = true;
      console.log(`\n✨ Creating new company: ${companyName}`);
      
      const companyResult = await client.query(
        `INSERT INTO companies (name, subdomain, email_domain, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id, name, subdomain, email_domain`,
        [companyName, subdomain.toLowerCase(), emailDomain]
      );

      company = companyResult.rows[0];
      console.log(`✅ Company created: ${company.name} (@${company.subdomain})`);
      if (company.email_domain) {
        console.log(`   📧 Email domain set: ${company.email_domain}`);
      }
    }

    // ✅ UPDATED: Upsert license WITH lms_license_id AND lms_user_id
    console.log("\n🎫 Upserting license record...");

    const licenseResult = await client.query(
      `INSERT INTO company_licenses (
         company_id, 
         license_key, 
         lms_license_id,
         plan, 
         max_users, 
         expires_at, 
         lms_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (company_id) 
       DO UPDATE SET 
         license_key = EXCLUDED.license_key,
         lms_license_id = EXCLUDED.lms_license_id,
         plan = EXCLUDED.plan,
         max_users = EXCLUDED.max_users,
         expires_at = EXCLUDED.expires_at,
         lms_user_id = EXCLUDED.lms_user_id,
         created_at = NOW()
       RETURNING id, license_key, lms_license_id, lms_user_id,
         (xmax = 0) AS inserted`,
      [
        company.id,
        licenseKey,
        lmsLicenseId,
        planType || "Standard",
        maxUsers || 1,
        expiryDate ? new Date(expiryDate) : null,
        lmsUserId || email
      ]
    );

    const licenseOp = licenseResult.rows[0].inserted ? "created" : "updated";
    const storedLmsLicenseId = licenseResult.rows[0].lms_license_id;
    const storedLmsUserId = licenseResult.rows[0].lms_user_id;
    
    console.log(`✅ License ${licenseOp}: ${licenseKey}`);
    console.log(`   📋 LMS License ID stored: ${storedLmsLicenseId || 'NONE'}`);
    console.log(`   📋 LMS User ID stored: ${storedLmsUserId}`);

    // ✅ NEW: Store transaction history
    console.log("\n💰 Recording transaction history...");
    
    const transactionType = isUpgrade ? 'upgrade' : 
                           isRenewal ? 'renewal' : 
                           'new_purchase';

    await client.query(
      `INSERT INTO license_transactions (
         company_id,
         lms_user_id,
         lms_license_id,
         transaction_type,
         license_key,
         plan_name,
         billing_cycle,
         original_amount,
         credit_applied,
         subtotal,
         gst_amount,
         total_paid,
         currency,
         max_users,
         max_clients,
         storage_per_user,
         api_calls_per_user,
         start_date,
         end_date,
         validity_days,
         payment_id,
         order_id,
         old_plan_name,
         old_license_key,
         raw_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       RETURNING id`,
      [
        company.id,
        lmsUserId || email,
        lmsLicenseId,
        transactionType,
        licenseKey,
        planType || 'Standard',
        billingCycle || 'monthly',
        originalAmount || 0,
        creditApplied || 0,
        subtotal || totalPaid || 0,
        gstAmount || 0,
        totalPaid || 0,
        'INR',
        maxUsers || 1,
        maxClients || null,
        storagePerUser || null,
        apiCallsPerUser || null,
        startDate ? new Date(startDate) : new Date(),
        expiryDate ? new Date(expiryDate) : null,
        validityDays || null,
        paymentId || null,
        orderId || null,
        oldPlanName || null,
        oldLicenseKey || null,
        JSON.stringify(req.body) // Store full payload for debugging
      ]
    );

    console.log(`✅ Transaction recorded: ${transactionType}`);

    // Handle user account
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
      
      if (user.company_id !== company.id) {
        await client.query(
          `UPDATE users SET company_id = $1 WHERE id = $2`,
          [company.id, user.id]
        );
        console.log(`✅ User reassigned to company: ${company.name}`);
      }
      
      if (password && password.trim() !== '') {

  // ✅ LMS already sends hashed password → store directly
  await client.query(
    `UPDATE users SET password = $1 WHERE id = $2`,
    [password, user.id]
  );

  console.log(`✅ User password hash stored (from LMS)`);
}


    } else {
      // CREATE NEW USER
      console.log(`\n👤 Creating new user account...`);

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

      await client.query(
        `INSERT INTO profiles (user_id, full_name)
         VALUES ($1, $2)`,
        [user.id, fullName || email.split('@')[0]]
      );
      console.log(`✅ Profile created`);
    }

    await client.query("COMMIT");

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
        emailDomain: company.email_domain,
        url: `https://${company.subdomain}.yourdomain.com`
      },
      user: {
        id: user.id,
        email: user.email,
        isAdmin: true,
        temporaryPassword: isNewCompany ? userPassword : undefined
      },
      license: {
        key: licenseKey,
        lmsLicenseId: storedLmsLicenseId,
        lmsUserId: storedLmsUserId,
        plan: planType,
        maxUsers: maxUsers,
        expiryDate: expiryDate,
        operation: licenseOp
      },
      transaction: {
        type: transactionType,
        totalPaid: totalPaid,
        billingCycle: billingCycle
      }
    });

  } catch (error) {
    await client.query("ROLLBACK");
    
    console.error("\n❌ License provisioning failed!");
    console.error("=" .repeat(60));
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    if (error.code === '23505' && error.constraint?.includes('license_key')) {
      return res.status(409).json({
        error: "LicenseKeyExists",
        message: `License key "${req.body.licenseKey}" is already in use`
      });
    }

    if (error.code === '23505' && error.constraint?.includes('email_domain')) {
      return res.status(409).json({
        error: "EmailDomainExists",
        message: `Email domain is already registered to another company`
      });
    }

    return res.status(500).json({
      error: "ProvisioningFailed",
      message: error.message
    });

  } finally {
    client.release();
  }
};