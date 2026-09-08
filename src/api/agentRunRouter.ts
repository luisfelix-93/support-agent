import { Router } from 'express';
import { agentRunController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { tenantRateLimiter } from './middlewares/rateLimiter.js';
import { Role } from '../domain/Role.js';

const router = Router();

/**
 * GET /api/runs/analytics/cost?tenantId=...&from=...&to=...
 * Resumo financeiro consolidado e consumo por tenant.
 */
router.get('/runs/analytics/cost',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('runs-analytics-cost'),
    (req, res) => agentRunController.getCostAnalytics(req, res)
);

/**
 * GET /api/runs/analytics/tools?tenantId=...&from=...&to=...
 * Estatísticas e taxa de sucesso por ferramenta/MCP.
 */
router.get('/runs/analytics/tools',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('runs-analytics-tools'),
    (req, res) => agentRunController.getToolAnalytics(req, res)
);

/**
 * GET /api/runs/analytics/llm?tenantId=...&from=...&to=...
 * Estatísticas de chamadas, tokens e custos por modelo LLM.
 */
router.get('/runs/analytics/llm',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('runs-analytics-llm'),
    (req, res) => agentRunController.getLLMAnalytics(req, res)
);

/**
 * GET /api/runs/:runId
 * Retorna os detalhes completos de uma execução específica.
 */
router.get('/runs/:runId',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('runs-get-by-id'),
    (req, res) => agentRunController.getById(req, res)
);

/**
 * GET /api/runs?tenantId=...&status=...&from=...&to=...&limit=...&offset=...
 * Lista execuções paginadas filtradas por tenant.
 */
router.get('/runs',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('runs-list-by-tenant'),
    (req, res) => agentRunController.list(req, res)
);

export default router;
