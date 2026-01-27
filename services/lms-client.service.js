// services/lms-client.service.js - FINAL FIX
// ✅ Uses owner's userId in URL path: POST /api/heartbeat/:userId

import { pool } from "../db.js";

const LMS_BASE_URL = process.env.LMS_API_URL || 'https://license-system.onrender.com';
const LMS_API_KEY = process.env.LMS_API_KEY || 'my-secret-key-123';

/**
 * Get company's LMS license info
 */
const getCompanyLicenseInfo = async (companyId) => {
  const result = await pool.query(
    'SELECT license_key, lms_user_id FROM company_licenses WHERE company_id = $1',
    [companyId]
  );
  
  if (result.rows.length === 0) {
    console.log(`⚠️ No license found for company ${companyId}`);
    return null;
  }
  
  return {
    licenseKey: result.rows[0].license_key,
    lmsUserId: result.rows[0].lms_user_id  // ✅ Owner's user ID
  };
};

/**
 * Send heartbeat to LMS with usage updates
 * ✅ CORRECT: Uses owner's userId in URL path as required by LMS API
 * 
 * API Format: POST /api/heartbeat/:userId
 * Where userId = ownerUserId (the person who bought the license)
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

    const { licenseKey, lmsUserId } = licenseInfo;

    // ✅ CHECK: Must have lms_user_id (owner's userId) for heartbeat
    if (!lmsUserId) {
      console.error(`❌ No lms_user_id found for company ${companyId}`);
      console.error(`   License Key: ${licenseKey}`);
      console.error(`   This license was created before lms_user_id was added.`);
      console.error(`   Heartbeat sync will fail until this is fixed.`);
      return { 
        success: false, 
        reason: 'NO_LMS_USER_ID',
        licenseKey 
      };
    }

    if (!LMS_API_KEY) {
      console.log(`⚠️ LMS_API_KEY not configured - skipping heartbeat`);
      return { success: false, reason: 'NO_API_KEY' };
    }

    const payload = {
      userId: lmsUserId,  // ✅ Owner's userId (same as URL path)
      features: features.map(f => ({
        slug: f.slug,
        value: f.value || 1
      }))
    };

    // ✅ CORRECT: Use owner's userId in the URL path
    // Example: POST /api/heartbeat/6978855e13c078aa8e53de74
    const url = `${LMS_BASE_URL}/api/heartbeat/${lmsUserId}`;
    
    console.log(`📤 Sending heartbeat to LMS:`);
    console.log(`   URL: ${url}`);
    console.log(`   License Key: ${licenseKey}`);
    console.log(`   Owner User ID: ${lmsUserId}`);
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
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      if (response.ok) {
        console.log(`✅ LMS heartbeat successful for user ${lmsUserId}:`, data);
        return { success: true, data };
      } else {
        console.error(`❌ LMS heartbeat failed: ${response.status}`);
        console.error(`   Response:`, data);
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
 * Verify user exists in LMS (for debugging)
 */
export const verifyUserInLMS = async (lmsUserId) => {
  try {
    const url = `${LMS_BASE_URL}/api/users/${lmsUserId}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${LMS_API_KEY}`,
        'x-api-key': LMS_API_KEY
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`✅ User ${lmsUserId} verified in LMS:`, data);
      return { exists: true, data };
    } else {
      console.log(`⚠️ User ${lmsUserId} not found in LMS: ${response.status}`);
      return { exists: false, status: response.status };
    }
  } catch (error) {
    console.error(`❌ Error verifying user in LMS:`, error.message);
    return { exists: false, error: error.message };
  }
};

/**
 * Increment user count in LMS
 */
export const incrementLMSUserCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'users_created', value: 1 }
  ]);
};

/**
 * Decrement user count in LMS
 */
export const decrementLMSUserCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'users_created', value: -1 }
  ]);
};

/**
 * Increment client count in LMS
 */
export const incrementLMSClientCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'clients_created', value: 1 }
  ]);
};

/**
 * Decrement client count in LMS
 */
export const decrementLMSClientCount = async (companyId) => {
  return sendLMSHeartbeat(companyId, [
    { slug: 'clients_created', value: -1 }
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
    { slug: 'storage_used_mb', value: sizeMB }
  ]);
};

/**
 * Send multiple feature updates at once
 */
export const sendBatchLMSUpdate = async (companyId, updates) => {
  return sendLMSHeartbeat(companyId, updates);
};