import 'dotenv/config';
import app from './app.js';
import { queueWorker } from './config/container.js';
import { logger } from './config/logger.js';

const log = logger.child({ module: 'bootstrap' });

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
    log.info({ port: PORT }, '🚀 Servidor rodando');
    log.info(`Health check: http://localhost:${PORT}/api/health`);
});

const shutdown = async (signal: string) => {
    log.info({ signal }, 'Recebido sinal. Iniciando graceful shutdown...');
    server.close(async () => {
        log.info('Servidor Express parado.');
        try {
            await queueWorker.stop();
            log.info('BullMQ Worker finalizado. Saindo de forma limpa...');
            process.exit(0);
        } catch (error) {
            log.error({ err: error }, 'Erro ao encerrar recursos');
            process.exit(1);
        }
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
