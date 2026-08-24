import 'dotenv/config';
import './config/tracing.js';
import type { Server } from 'node:http';
import express from 'express';
import app from './app.js';
import { queueWorker } from './config/container.js';
import { logger } from './config/logger.js';
import { metricsHandler } from './config/metrics.js';
import { shutdownTracing } from './config/tracing.js';

const log = logger.child({ module: 'bootstrap' });

const PORT = Number(process.env.PORT) || 3000;
const METRICS_PORT = Number(process.env.METRICS_PORT) || 9090;

const server = app.listen(PORT, () => {
    log.info({ port: PORT }, '🚀 Servidor rodando');
    log.info(`Health check: http://localhost:${PORT}/api/health`);
});

const metricsApp = express();
metricsApp.get('/metrics', metricsHandler);

const metricsServer = metricsApp.listen(METRICS_PORT, () => {
    log.info({ port: METRICS_PORT }, 'Servidor de métricas rodando');
    log.info(`Metrics: http://localhost:${METRICS_PORT}/metrics`);
});

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

const shutdown = async (signal: string) => {
    log.info({ signal }, 'Recebido sinal. Iniciando graceful shutdown...');

    try {
        await Promise.all([closeServer(server), closeServer(metricsServer)]);
        await queueWorker.stop();
        await shutdownTracing();
        log.info('Servidores HTTP, BullMQ Worker e OpenTelemetry finalizados. Saindo de forma limpa...');
        process.exit(0);
    } catch (error) {
        log.error({ err: error }, 'Erro ao encerrar recursos');
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
