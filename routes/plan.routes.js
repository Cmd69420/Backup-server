// routes/plan.routes.js
// NEW FILE: Plan management and usage endpoints

import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth.js";
import { attachCompanyContext, requireSuperAdmin } from "../middleware/company.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { 
  getCompanyPlanFeatures, 
  getAllPlans, 
  upgradeCompanyPlan,
  checkUserLimit,
  checkClientLimit,
  getCompanyUsage
} from "../services/plan.service.js";

const router = express.Router();

// ============================================
// GET CURRENT COMPANY'S PLAN & FEATURES
// ============================================
// Available to all authenticated users to see their plan
router.get(
  "/my-plan",
  authenticateToken,
  attachCompanyContext,
  asyncHandler(async (req, res) => {
    const features = await getCompanyPlanFeatures(req.companyId);
    const userLimit = await checkUserLimit(req.companyId);
    const clientLimit = await checkClientLimit(req.companyId);
    const usage = await getCompanyUsage(req.companyId);
    
    res.json({
      plan: features,
      usage: {
        users: {
          current: userLimit.currentUsers,
          max: userLimit.maxUsers,
          remaining: userLimit.remaining,
          percentage: ((userLimit.currentUsers / userLimit.maxUsers) * 100).toFixed(1)
        },
        clients: {
          current: clientLimit.currentClients,
          max: clientLimit.maxClients,
          remaining: clientLimit.unlimited ? null : clientLimit.remaining,
          unlimited: clientLimit.unlimited,
          percentage: clientLimit.unlimited ? null : ((clientLimit.currentClients / clientLimit.maxClients) * 100).toFixed(1)
        },
        services: usage.services,
        meetings: usage.meetings,
        expenses: usage.expenses,
        locationLogs: usage.locationLogs
      }
    });
  })
);

// ============================================
// GET ALL AVAILABLE PLANS (For Pricing Page)
// ============================================
// Public endpoint - anyone can see available plans
router.get(
  "/available-plans",
  asyncHandler(async (req, res) => {
    const plans = await getAllPlans();
    
    // Format for frontend display
    const formattedPlans = plans.map(plan => ({
      name: plan.plan_name,
      displayName: plan.display_name,
      price: plan.price_inr,
      limits: {
        users: plan.max_users,
        clients: plan.max_clients,
        storageGB: plan.max_cloud_storage_gb,
        servicesPerClient: plan.max_services_per_client,
        importBatchSize: plan.client_import_batch_size
      },
      features: {
        services: plan.services_enabled,
        tallySync: plan.tally_sync_enabled,
        apiAccess: plan.api_access_enabled,
        advancedAnalytics: plan.advanced_analytics_enabled,
        customReports: plan.custom_reports_enabled,
        interactiveMaps: plan.interactive_maps_enabled,
        bulkOperations: plan.bulk_operations_enabled,
        whiteLabel: plan.white_label_enabled
      },
      history: {
        locationDays: plan.location_history_days,
        meetingDays: plan.meeting_history_days,
        expenseDays: plan.expense_history_days
      }
    }));
    
    res.json({ plans: formattedPlans });
  })
);

// ============================================
// UPGRADE COMPANY PLAN (Company Admin Only)
// ============================================
router.post(
  "/upgrade",
  authenticateToken,
  attachCompanyContext,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { planName } = req.body;
    
    if (!planName) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Plan name is required"
      });
    }
    
    // Validate plan exists
    const allPlans = await getAllPlans();
    const planExists = allPlans.some(p => p.plan_name === planName);
    
    if (!planExists) {
      return res.status(400).json({
        error: "InvalidPlan",
        message: `Plan '${planName}' does not exist`,
        availablePlans: allPlans.map(p => p.plan_name)
      });
    }

    await upgradeCompanyPlan(req.companyId, planName);
    const newFeatures = await getCompanyPlanFeatures(req.companyId);
    
    console.log(`✅ Company ${req.companyId} upgraded to ${planName} by user ${req.user.email}`);
    
    res.json({
      message: "Plan upgraded successfully",
      previousPlan: req.planFeatures?.planName,
      newPlan: newFeatures,
      effectiveImmediately: true
    });
  })
);

// ============================================
// GET PLAN USAGE DETAILS (Company Admin Only)
// ============================================
router.get(
  "/usage",
  authenticateToken,
  attachCompanyContext,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const usage = await getCompanyUsage(req.companyId);
    const features = await getCompanyPlanFeatures(req.companyId);
    const userLimit = await checkUserLimit(req.companyId);
    const clientLimit = await checkClientLimit(req.companyId);
    
    res.json({
      planName: features.planName,
      limits: features.limits,
      currentUsage: usage,
      warnings: {
        usersNearLimit: userLimit.currentUsers >= userLimit.maxUsers * 0.8,
        clientsNearLimit: !clientLimit.unlimited && clientLimit.currentClients >= clientLimit.maxClients * 0.8
      }
    });
  })
);

// ============================================
// SUPER ADMIN: SET ANY COMPANY'S PLAN
// ============================================
router.post(
  "/admin/set-plan/:companyId",
  authenticateToken,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const { companyId } = req.params;
    const { planName } = req.body;
    
    if (!planName) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Plan name is required"
      });
    }

    await upgradeCompanyPlan(companyId, planName);
    const newFeatures = await getCompanyPlanFeatures(companyId);
    
    console.log(`👑 Super Admin ${req.user.email} set company ${companyId} to ${planName}`);
    
    res.json({
      message: "Plan updated successfully",
      companyId,
      newPlan: newFeatures
    });
  })
);

// ============================================
// SUPER ADMIN: GET ALL PLANS WITH DETAILS
// ============================================
router.get(
  "/admin/all-plans",
  authenticateToken,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const plans = await getAllPlans();
    res.json({ 
      plans,
      totalPlans: plans.length 
    });
  })
);

export default router;