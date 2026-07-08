import { Router } from 'express';
import { onboardingController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';

const router = Router();

// ─── Public routes ──────────────────────────────────────
// POST /api/onboarding/users
router.post('/onboarding/users', (req, res) => onboardingController.registerUser(req, res));

// POST /api/onboarding/tenants
router.post('/onboarding/tenants', (req, res) => onboardingController.registerTenant(req, res));

// POST /api/onboarding/spaces
router.post('/onboarding/spaces', (req, res) => onboardingController.registerSpace(req, res));

// ─── Protected routes (require valid JWT) ───────────────
// POST /api/onboarding/associate-tenant
router.post('/onboarding/associate-tenant', authMiddleware, (req, res) =>
    onboardingController.associateTenant(req, res)
);

export default router;
