import { Router } from 'express';
import { slackWebhookController } from '../config/container.js';

const router = Router();

/**
 * POST /api/slack/events
 *
 * Recebe todos os eventos da Slack Event API.
 * O raw body já foi capturado pelo middleware em app.ts antes do express.json().
 */
router.post('/slack/events', (req, res) => slackWebhookController.handle(req, res));

export default router;
