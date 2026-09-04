import { Router } from 'express';
import { chatConfigController } from '../config/container.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { requireRole } from './middlewares/requireRole.js';
import { auditLogger } from './middlewares/auditLogger.js';
import { Role } from '../domain/Role.js';

const router = Router();

/**
 * POST /api/chat-configs
 * Cadastra ou atualiza as credenciais do bot do Slack (ou outro provedor) para um workspace.
 */
router.post('/chat-configs',
    authMiddleware,
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
    auditLogger('get-chat-config'),
    (req, res) => chatConfigController.getByWorkspaceId(req, res)
);

export default router;
