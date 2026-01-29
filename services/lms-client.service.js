// services/lms-client.service.js - FINAL CORRECT VERSION
// ✅ Uses lms_license_id in URL path and userId in body

import { pool } from "../db.js";

const LMS_BASE_URL = process.env.LMS_API_URL || 'https://lisence-system.onrender.com';
const LMS_API_KEY = process.env.LMS_API_KEY || 'my-secret-key-123';

/**
 * Get company's LMS license info
 */
const getCompanyLicenseInfo = async (companyId) => {
  const result = await pool.query(
    'SELECT license_key, lms_license_id, lms_user_id FROM company_licenses WHERE company_id = $1',
    [companyId]
  );
  
  if (result.rows.length === 0) {
    console.log(`⚠️ No license found for company ${companyId}`);
    return null;
  }
  
  return {
    licenseKey: result.rows[0].license_key,
    lmsLicenseId: result.rows[0].lms_license_id,  // ✅ MongoDB _id for URL
    lmsUserId: result.rows[0].lms_user_id          // ✅ Owner userId for body
  };
};

/**
 * Send heartbeat to LMS with usage updates
 * ✅ CORRECT API FORMAT:
 *    POST /api/heartbeat/:licenseId
 *    Body: { userId, features }
 * 
 * @param {string} companyId - Company ID
 * @param {Array} features - Array of {slug, value} objects
 */
export const sendLMSHeartbeat = async (companyId, features = []) => {
  try {
    const licenseInfo = await getCompanyLicenseInfo(companyId);
    
    if (!licenseInfo) {
      console.log(`⚠️ Skipping LMS heartbeat - no license for company ${companyId}`);
      return { success: false, reason: 'NO_LICENSE' };
    }

    const { licenseKey, lmsLicenseId, lmsUserId } = licenseInfo;

    // ✅ CHECK: Must have lms_license_id for URL path
    if (!lmsLicenseId) {
      console.error(`❌ No lms_license_id found for company ${companyId}`);
      console.error(`   License Key: ${licenseKey}`);
      console.error(`   LMS User ID: ${lmsUserId || 'NONE'}`);
      console.error(`   ⚠️ This license needs lms_license_id to be set!`);
      console.error(`   Run this SQL after finding the MongoDB _id from LMS:`);
      console.error(`   UPDATE company_licenses SET lms_license_id = 'MONGODB_ID_HERE' WHERE license_key = '${licenseKey}';`);
      return { 
        success: false, 
        reason: 'NO_LMS_LICENSE_ID',
        licenseKey 
      };
    }

    if (!lmsUserId) {
      console.warn(`⚠️ No lms_user_id found, using license key as fallback`);
    }

    if (!LMS_API_KEY) {
      console.log(`⚠️ LMS_API_KEY not configured - skipping heartbeat`);
      return { success: false, reason: 'NO_API_KEY' };
    }

    const payload = {
      userId: lmsUserId || licenseKey,  // ✅ Owner userId in body
      features: features.map(f => ({
        slug: f.slug,
        value: f.value || 1
      }))
    };

    // ✅ CORRECT: Use lms_license_id (MongoDB _id) in URL path
    // Example: POST /api/heartbeat/6972048cf19aeec8c14bb571
    const url = `${LMS_BASE_URL}/api/heartbeat/${lmsLicenseId}`;
    
    console.log(`📤 Sending heartbeat to LMS:`);
    console.log(`   URL: ${url}`);
    console.log(`   License Key: ${licenseKey}`);
    console.log(`   LMS License ID: ${lmsLicenseId}`);
    console.log(`   LMS User ID: ${lmsUserId}`);
    console.log(`   Payload:`, JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${LMS_API_KEY}`,
          'x-api-key': LMS_API_KEY
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      });

      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (response.ok) {
        console.log(`✅ LMS heartbeat successful:`, data);
        return { success: true, data };
      } else {
        console.error(`❌ LMS heartbeat failed: ${response.status}`);
        console.error(`   Response:`, data);
        
        if (response.status === 404) {
          console.error(`   💡 License ${lmsLicenseId} not found in LMS!`);
          console.error(`   Verify this MongoDB _id exists in your LMS database.`);
        }
        
        return { success: false, status: response.status, error: data };
      }

    } catch (error) {
      console.error(`❌ LMS heartbeat network error:`, error.message);
      return { success: false, error: error.message };
    }

  } catch (error) {
    console.error('❌ LMS heartbeat error:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Increment user count in LMS
 */
export const incrementLMSUserCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'user-limit', value: 1 }
  ]);
};

/**
 * Decrement user count in LMS
 */
export const decrementLMSUserCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'user-limit', value: -1 }
  ]);
};

/**
 * Increment client count in LMS
 */
export const incrementLMSClientCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'client-record-limit', value: 1 }
  ]);
};

/**
 * Decrement client count in LMS
 */
export const decrementLMSClientCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'client-record-limit', value: -1 }
  ]);
};

/**
 * Increment service count in LMS
 */
export const incrementLMSServiceCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'services_created', value: 1 }
  ]);
};

/**
 * Decrement service count in LMS
 */
export const decrementLMSServiceCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'services_created', value: -1 }
  ]);
};

/**
 * Increment storage usage in LMS
 */
export const incrementLMSStorageUsed = async (companyId, sizeMB) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'storage-per-user', value: sizeMB }
  ]);
};

/**
 * Send multiple feature updates at once
 */
export const sendBatchLMSUpdate = async (companyId, updates) => {
  return sendLMSHeartbeat(companyId, updates);
};