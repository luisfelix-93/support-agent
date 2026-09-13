import { Router } from 'express';
import { memoryController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { tenantRateLimiter } from './middlewares/rateLimiter.js';
import { Role } from '../domain/Role.js';

const router = Router();

/**
 * GET /api/memories?tenantId=...&status=...&type=...&tag=...&limit=20&offset=0
 * Listagem paginada de memórias corporativas.
 */
router.get('/memories',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN, Role.OPERATOR, Role.VIEWER),
    auditLogger('memories-list'),
    (req, res) => memoryController.list(req, res)
);

/**
 * POST /api/memories/search
 * Busca híbrida (vetorial + textual + RRF + Reranker).
 */
router.post('/memories/search',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN, Role.OPERATOR, Role.VIEWER),
    auditLogger('memories-search'),
    (req, res) => memoryController.search(req, res)
);

/**
 * GET /api/memories/candidates?tenantId=...&limit=20
 * Fila de memórias candidatas pendentes de curadoria/validação.
 */
router.get('/memories/candidates',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN, Role.OPERATOR),
    auditLogger('memories-get-candidates'),
    (req, res) => memoryController.getCandidates(req, res)
);

/**
 * PATCH /api/memories/:id/status
 * Transição de status do ciclo de vida da memória (com validação de máquina de estados).
 */
router.patch('/memories/:id/status',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN, Role.OPERATOR),
    auditLogger('memories-update-status'),
    (req, res) => memoryController.updateStatus(req, res)
);

/**
 * PUT /api/memories/:id
 * Edição de conteúdo, importância ou tags de uma memória.
 */
router.put('/memories/:id',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN, Role.OPERATOR),
    auditLogger('memories-update'),
    (req, res) => memoryController.update(req, res)
);

/**
 * DELETE /api/memories/:id
 * Remoção definitiva de uma memória (permissão de admin).
 */
router.delete('/memories/:id',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('memories-delete'),
    (req, res) => memoryController.delete(req, res)
);

export default router;
