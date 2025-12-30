import crypto from "crypto";
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

  const {
    purchaseId,
    licenseKey,
    email,
    fullName,
    companyName,
    subdomain,
    planType,
    maxUsers,
    expiryDate,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /**
     * --------------------------------------------------
     * 1. IDEMPOTENCY CHECK
     * --------------------------------------------------
     */
    const existing = await client.query(
      "SELECT company_id FROM company_licenses WHERE license_key = $1",
      [licenseKey]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.json({ status: "AlreadyProcessed" });
    }

    /**
     * --------------------------------------------------
     * 2. CREATE COMPANY
     * --------------------------------------------------
     */
    const companyRes = await client.query(
      `INSERT INTO companies (name, subdomain, is_active)
       VALUES ($1, $2, true)
       RETURNING id`,
      [companyName, subdomain]
    );

    const companyId = companyRes.rows[0].id;

    /**
     * --------------------------------------------------
     * 3. CREATE ADMIN USER (NO PASSWORD)
     * --------------------------------------------------
     */
    // Generate a random, unusable password hash (schema-safe)
const unusablePasswordHash = crypto
  .createHash("sha256")
  .update(crypto.randomBytes(64))
  .digest("hex");

const userRes = await client.query(
  `INSERT INTO users (
    email,
    password,
    is_admin,
    is_super_admin,
    company_id,
    auth_source
  )
  VALUES ($1, $2, true, false, $3, 'lms')
  RETURNING id`,
  [email, unusablePasswordHash, companyId]
);

    /**
     * --------------------------------------------------
     * 4. STORE LICENSE
     * --------------------------------------------------
     */
    await client.query(
      `INSERT INTO company_licenses (
        company_id,
        license_key,
        plan,
        max_users,
        expires_at,
        purchase_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        companyId,
        licenseKey,
        planType,
        maxUsers,
        expiryDate,
        purchaseId,
      ]
    );

    await client.query("COMMIT");

    /**
     * --------------------------------------------------
     * 5. RESPONSE
     * --------------------------------------------------
     */
    return res.status(201).json({
      status: "CREATED",
      company: {
        id: companyId,
        name: companyName,
        subdomain,
      },
      adminUser: {
        email,
      },
      login_url: `https://${subdomain}.yourdomain.com/login`,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ LMS LICENSE HANDLER ERROR:", err);
    return res.status(500).json({
      error: "LicenseProvisionFailed",
      message: err.message,
    });
  } finally {
    client.release();
  }
};
