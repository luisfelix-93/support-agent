import express, { type Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import webhookRouter from './api/webhookRouter.js';
import authRouter from './api/authRouter.js';
import onboardingRouter from './api/onboardingRouter.js';
import slackRouter from './api/slackRouter.js';
import { apiRateLimiter, authRateLimiter } from './api/middlewares/rateLimiter.js';

const app = express();

// Configura o Express para confiar em exatamente 1 proxy (Traefik/Ingress) na cadeia.
// Usar `true` é rejeitado pelo express-rate-limit v7+ (ERR_ERL_PERMISSIVE_TRUST_PROXY).
app.set('trust proxy', 1);

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

// ─── Rate Limiting ───────────────────────────────────
// Limite estrito para autenticação e onboarding
app.use('/api/auth', authRateLimiter);
app.use('/api/onboarding', authRateLimiter);

// Limite geral para todas as outras rotas da API
app.use('/api', apiRateLimiter);

// ─── Rotas da API ────────────────────────────────────
app.use('/api', webhookRouter);
app.use('/api', authRouter);
app.use('/api', onboardingRouter);
app.use('/api', slackRouter);

export default app;
