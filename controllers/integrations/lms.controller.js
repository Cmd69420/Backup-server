import bcrypt from "bcryptjs";
import { pool } from "../../db.js";

export const handleLicensePurchase = async (req, res) => {
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
    expiryDate
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Idempotency (important)
    const existing = await client.query(
      "SELECT company_id FROM company_licenses WHERE license_key = $1",
      [licenseKey]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.json({ status: "AlreadyProcessed" });
    }

    // Create company
    const companyRes = await client.query(
      `INSERT INTO companies (name, subdomain, is_active)
       VALUES ($1, $2, true)
       RETURNING id`,
      [companyName, subdomain]
    );
    const companyId = companyRes.rows[0].id;

    // Create admin user (password comes from LMS)
    const hashed = await bcrypt.hash(password, 12);
    const userRes = await client.query(
      `INSERT INTO users (
        email, password, is_admin, is_super_admin, company_id, auth_source
      )
      VALUES ($1, $2, true, false, $3, 'lms')
      RETURNING id`,
      [email, hashed, companyId]
    );

    await client.query(
      `INSERT INTO profiles (user_id, full_name)
       VALUES ($1, $2)`,
      [userRes.rows[0].id, fullName]
    );

    // Store license
    await client.query(
      `INSERT INTO company_licenses (
        company_id, license_key, plan, max_users, expires_at
      )
      VALUES ($1, $2, $3, $4, $5)`,
      [companyId, licenseKey, planType, maxUsers, expiryDate]
    );

    await client.query("COMMIT");

    res.status(201).json({
      status: "CREATED",
      login_url: `https://${subdomain}.yourdomain.com/login`
    });

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
