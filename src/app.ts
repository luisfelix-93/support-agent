import express, { type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import webhookRouter from './api/webhookRouter.js';
import workerRouter from './api/workerRouter.js';
import authRouter from './api/authRouter.js';
import onboardingRouter from './api/onboardingRouter.js';
import slackRouter from './api/slackRouter.js';

const app = express();

// ─── Middlewares Globais ─────────────────────────────
app.use(helmet());
app.use(cors());

// Captura o raw body para a verificação de assinatura do Slack (HMAC-SHA256).
// O campo `rawBody` fica disponível em req como propriedade adicional.
app.use(
    express.json({
        verify: (req: Request & { rawBody?: string }, _res, buf) => {
            req.rawBody = buf.toString('utf-8');
        },
    })
);

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
app.use('/api', authRouter);
app.use('/api', onboardingRouter);
app.use('/api', slackRouter);

export default app;
