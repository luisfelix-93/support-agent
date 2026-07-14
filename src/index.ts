import 'dotenv/config';
import app from './app.js';
import { queueWorker } from './config/container.js';

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
    console.log(`[Support Agent] 🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`[Support Agent] Health check: http://localhost:${PORT}/api/health`);
});

const shutdown = async (signal: string) => {
    console.log(`[Support Agent] Recebido sinal ${signal}. Iniciando graceful shutdown...`);
    server.close(async () => {
        console.log('[Support Agent] Servidor Express parado.');
        try {
            await queueWorker.stop();
            console.log('[Support Agent] BullMQ Worker finalizado. Saindo de forma limpa...');
            process.exit(0);
        } catch (error) {
            console.error('[Support Agent] Erro ao encerrar recursos:', error);
            process.exit(1);
        }
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
