import { Router } from 'express';
import { authController } from '../config/container.js';

const router = Router();

// POST /api/auth/login
router.post('/auth/login', (req, res) => authController.login(req, res));

export default router;
