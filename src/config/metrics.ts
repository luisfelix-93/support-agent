import client from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

/**
 * Métricas Prometheus da aplicação.
 *
 * Endpoint: GET /metrics (montado em app.ts, fora do prefixo /api —
 * não passa pelo rate limiter, pois o scrape do Prometheus deve ser livre).
 *
 * Proteção opcional: se METRICS_TOKEN estiver definido, o endpoint exige
 * header `Authorization: Bearer <METRICS_TOKEN>`. Recomendado caso a porta
 * do pod seja acessível fora da rede interna do cluster.
 *
 * Métricas expostas:
 *  - Default do Node.js (CPU, memória, event loop, GC) via collectDefaultMetrics
 *  - http_request_duration_seconds (Histogram): latência por método/rota/status
 *  - http_requests_total (Counter): volume por método/rota/status
 *
 * Os labels de rota usam o padrão do Express (ex.: /api/webhook/:id) e não a
 * URL bruta, evitando explosão de cardinalidade no Prometheus.
 */

export const metricsRegister = new client.Registry();

metricsRegister.setDefaultLabels({
    app: 'support-agent',
    environment: process.env.NODE_ENV ?? 'development',
});

client.collectDefaultMetrics({ register: metricsRegister });

export const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [metricsRegister],
});

export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total de requisições HTTP recebidas.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [metricsRegister],
});

// Rotas de infraestrutura que não devem entrar nas métricas de negócio
const EXCLUDED_PATHS = new Set(['/metrics', '/api/health', '/favicon.ico']);

/**
 * Retorna o padrão da rota Express (ex.: /api/auth/login) para usar como label.
 * Requests sem rota correspondente (404s) são agrupados em "unmatched".
 */
function normalizeRoute(req: Request): string {
    const route = (req.route as { path?: string } | undefined)?.path;
    if (typeof route === 'string') {
        return `${req.baseUrl}${route}`;
    }
    return 'unmatched';
}

/**
 * Middleware que mede duração e conta cada requisição HTTP.
 * Deve ser registrado antes dos routers.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (EXCLUDED_PATHS.has(req.path)) {
        next();
        return;
    }

    const endTimer = httpRequestDuration.startTimer();

    res.on('finish', () => {
        const labels = {
            method: req.method,
            route: normalizeRoute(req),
            status_code: String(res.statusCode),
        };
        endTimer(labels);
        httpRequestsTotal.inc(labels);
    });

    next();
}

/**
 * Handler do GET /metrics. Exige Bearer token apenas se METRICS_TOKEN estiver definido.
 */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
    const token = process.env.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    res.setHeader('Content-Type', metricsRegister.contentType);
    res.send(await metricsRegister.metrics());
}
