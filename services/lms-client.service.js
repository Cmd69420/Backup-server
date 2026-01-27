// services/lms-client.service.js
// Client for communicating with License Management System (LMS)

import { pool } from "../db.js";

const LMS_BASE_URL = process.env.LMS_API_URL || 'https://license-system.onrender.com';
const LMS_API_KEY = process.env.LMS_API_KEY; // Your API key for authenticating with LMS

/**
 * Get company's license key AND LMS user ID
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
    lmsUserId: result.rows[0].lms_user_id
  };
};

/**
 * Send heartbeat to LMS with usage updates
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

    if (!lmsUserId) {
      console.log(`⚠️ No LMS user ID found for company ${companyId} - using license key as fallback`);
    }

    const payload = {
      licenseId: licenseKey,
      userId: lmsUserId || licenseKey, // ✅ Use stored LMS user ID (license owner)
      features: features.map(f => ({
        slug: f.slug,
        value: f.value || 1
      }))
    };

    console.log(`📤 Sending heartbeat to LMS for license owner ${lmsUserId}:`, payload);

    const response = await fetch(`${LMS_BASE_URL}/api/heartbeat/${licenseKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LMS_API_KEY}`,
        'x-api-key': LMS_API_KEY
      },
      body: JSON.stringify(payload),
      timeout: 5000
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ LMS heartbeat failed: ${response.status} - ${errorText}`);
      return { success: false, status: response.status, error: errorText };
    }

    const data = await response.json();
    console.log(`✅ LMS heartbeat successful for ${lmsUserId}:`, data);
    
    return { success: true, data };

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