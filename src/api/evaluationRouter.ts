import { Router } from 'express';
import { evaluationController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { tenantRateLimiter } from './middlewares/rateLimiter.js';
import { Role } from '../domain/Role.js';

const router = Router();

/**
 * GET /api/evaluations/stats/:version
 * Estatísticas agregadas de uma versão do agente.
 */
router.get('/evaluations/stats/:version',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-stats'),
    (req, res) => evaluationController.getVersionStats(req, res)
);

/**
 * GET /api/evaluations/compare?versionA=1.0.0&versionB=1.1.0&threshold=0.10
 * Comparação de desempenho entre duas versões do agente.
 */
router.get('/evaluations/compare',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-compare'),
    (req, res) => evaluationController.compareVersions(req, res)
);

/**
 * GET /api/evaluations/regression?currentVersion=2.0.0&previousVersion=1.9.0&threshold=0.10
 * Detecção automática de regressão entre versões.
 */
router.get('/evaluations/regression',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-regression'),
    (req, res) => evaluationController.detectRegression(req, res)
);

/**
 * GET /api/evaluations/summary/:tenantId?from=...&to=...
 * Resumo consolidado de avaliações por tenant.
 */
router.get('/evaluations/summary/:tenantId',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-tenant-summary'),
    (req, res) => evaluationController.getTenantSummary(req, res)
);

/**
 * GET /api/evaluations/:runId
 * Consulta o resultado da avaliação de uma execução específica.
 */
router.get('/evaluations/:runId',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-get-by-run'),
    (req, res) => evaluationController.getByRunId(req, res)
);

/**
 * GET /api/evaluations?tenantId=X&limit=20&skip=0
 * Lista avaliações paginadas por tenant.
 */
router.get('/evaluations',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('evaluations-list-tenant'),
    (req, res) => evaluationController.listByTenant(req, res)
);

export default router;
