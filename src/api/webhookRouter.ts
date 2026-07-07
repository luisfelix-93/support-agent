import { Router } from 'express';
import { webhookController } from '../config/container.js';

const router = Router();

router.post('/webhook', (req, res) => webhookController.handle(req, res));

export default router;
