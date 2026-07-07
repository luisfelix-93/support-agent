import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import webhookRouter from './api/webhookRouter.js';
import workerRouter from './api/workerRouter.js';

const app = express();

// ─── Middlewares Globais ─────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ─── Health Check ────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// ─── Rotas da API ────────────────────────────────────
app.use('/api', webhookRouter);
app.use('/api', workerRouter);

export default app;
