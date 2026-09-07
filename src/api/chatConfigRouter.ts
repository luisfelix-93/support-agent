import { Router } from 'express';
import { chatConfigController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { tenantGuard } from './middlewares/tenantGuard.js';
import { Role } from '../domain/Role.js';
import { tenantRateLimiter } from './middlewares/rateLimiter.js';

const router = Router();

/**
 * POST /api/chat-configs
 * Cadastra ou atualiza as credenciais do bot do Slack (ou outro provedor) para um workspace.
 */
router.post('/chat-configs',
    authMiddleware,
    tenantRateLimiter,
    requireRole(Role.ADMIN),
    auditLogger('register-chat-config'),
    (req, res) => chatConfigController.register(req, res)
);

/**
 * GET /api/chat-configs/:workspaceId
 * Consulta o status e metadados da configuração do bot de um workspace (sem expor segredos).
 */
router.get('/chat-configs/:workspaceId',
    authMiddleware,
    tenantRateLimiter,
    tenantGuard('workspaceId'),
    auditLogger('get-chat-config'),
    (req, res) => chatConfigController.getByWorkspaceId(req, res)
);

export default router;
