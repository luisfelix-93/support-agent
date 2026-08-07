import { Worker, type Job } from 'bullmq';
import type { ProcessAgentResponseUse } from '../../usecases/ProcessAgentResponseUseCase.js';
import type { IChatProvider } from '../../domain/ports/IChatProvider.js';
import { logger } from '../../config/logger.js';

const log = logger.child({ module: 'BullMQWorker' });

export class BullMQWorker {
    private worker: Worker | null = null;

    constructor(
        private readonly redisConnection: any,
        private readonly processUseCase: ProcessAgentResponseUse,
        private readonly chatProviders: Record<string, IChatProvider>,
        private readonly queueName: string = 'message-processing'
    ) {}

    start(): void {
        if (this.worker) {
            log.warn('Worker já está rodando.');
            return;
        }

        log.info({ queueName: this.queueName }, 'Iniciando escuta na fila.');

        this.worker = new Worker(
            this.queueName,
            async (job: Job) => {
                const { workspaceId, threadId, content, source } = job.data;
                log.info({ jobId: job.id, threadId, source }, 'Processando job.');

                const chatProvider = this.chatProviders[source];
                if (!chatProvider) {
                    throw new Error(`Chat provider desconhecido: ${source}`);
                }

                // Dispara o caso de uso (Orquestração do agente)
                await this.processUseCase.execute(workspaceId, threadId, content, chatProvider);
            },
            {
                connection: this.redisConnection,
                concurrency: Number(process.env.QUEUE_CONCURRENCY) || 5,
            }
        );

        this.worker.on('completed', (job) => {
            log.info({ jobId: job.id }, 'Job processado com sucesso.');
        });

        this.worker.on('failed', (job, err) => {
            log.error({ err, jobId: job?.id }, 'Job falhou.');
        });

        this.worker.on('error', (err) => {
            log.error({ err }, 'Erro crítico no worker.');
        });
    }

    async stop(): Promise<void> {
        if (this.worker) {
            log.info('Parando escuta da fila...');
            await this.worker.close();
            this.worker = null;
            log.info('Worker parado com sucesso.');
        }
    }
}
