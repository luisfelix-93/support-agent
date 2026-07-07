import { Router } from 'express';
import { workerController } from '../config/container.js';

const router = Router();

router.post('/worker', (req, res) => workerController.handler(req, res));

export default router;
