import { Router } from 'express';
import { onboardingController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { Role } from '../domain/Role.js';

const router = Router();

// ─── Public routes ──────────────────────────────────────
// POST /api/onboarding/users
router.post('/onboarding/users',
    auditLogger('register-user'),
    (req, res) => onboardingController.registerUser(req, res)
);

// ─── Protected routes (require ADMIN role) ──────────────
// POST /api/onboarding/tenants
router.post('/onboarding/tenants',
    authMiddleware,
    requireRole(Role.ADMIN),
    auditLogger('register-tenant'),
    (req, res) => onboardingController.registerTenant(req, res)
);

// POST /api/onboarding/spaces
router.post('/onboarding/spaces',
    authMiddleware,
    requireRole(Role.ADMIN),
    auditLogger('register-space'),
    (req, res) => onboardingController.registerSpace(req, res)
);

// POST /api/onboarding/associate-tenant
router.post('/onboarding/associate-tenant',
    authMiddleware,
    requireRole(Role.ADMIN),
    auditLogger('associate-tenant'),
    (req, res) => onboardingController.associateTenant(req, res)
);

export default router;
