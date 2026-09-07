import 'dotenv/config';
import './config/tracing.js';
import type { Server } from 'node:http';
import express from 'express';
import app from './app.js';
import { queueWorker, memoryPromotionWorker, redisConnection } from './config/container.js';
import { MongoConnection } from './infrastructure/database/MongoConnection.js';
import { logger } from './config/logger.js';
import { metricsHandler } from './config/metrics.js';
import { shutdownTracing } from './config/tracing.js';

const log = logger.child({ module: 'bootstrap' });

const PORT = Number(process.env.PORT) || 3000;
const METRICS_PORT = Number(process.env.METRICS_PORT) || 9090;

const server = app.listen(PORT, () => {
    log.info({ port: PORT }, '🚀 Servidor rodando');
    log.info(`Health check: http://localhost:${PORT}/api/health`);
    log.info(`Readiness check: http://localhost:${PORT}/api/health/ready`);
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

    // Safety timeout de 30s para evitar travamento indefinido
    const forceExitTimeout = setTimeout(() => {
        log.error('Timeout de 30s excedido durante o shutdown. Forçando encerramento imediato.');
        process.exit(1);
    }, 30000);
    forceExitTimeout.unref();

    try {
        log.info('1/5 Encerrando servidores HTTP (App e Metrics)...');
        await Promise.all([closeServer(server), closeServer(metricsServer)]);
        log.info('Servidores HTTP finalizados.');

        log.info('2/5 Parando e drenando workers BullMQ...');
        await Promise.all([queueWorker.stop(), memoryPromotionWorker.stop()]);
        log.info('Workers BullMQ finalizados.');

        log.info('3/5 Finalizando tracing do OpenTelemetry...');
        await shutdownTracing();
        log.info('Tracing OpenTelemetry finalizado.');

        log.info('4/5 Desconectando cliente Redis...');
        if (redisConnection && redisConnection.status !== 'end') {
            await redisConnection.quit();
        }
        log.info('Conexão Redis finalizada.');

        log.info('5/5 Desconectando MongoDB...');
        await MongoConnection.disconnect();
        log.info('Conexão MongoDB finalizada.');

        clearTimeout(forceExitTimeout);
        log.info('Graceful shutdown concluído com sucesso. Saindo de forma limpa.');
        process.exit(0);
    } catch (error) {
        clearTimeout(forceExitTimeout);
        log.error({ err: error }, 'Erro durante encerramento gracioso de recursos');
        process.exit(1);
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
