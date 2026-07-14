import { Worker, type Job } from 'bullmq';
import type { ProcessAgentResponseUse } from '../../usecases/ProcessAgentResponseUseCase.js';
import type { IChatProvider } from '../../domain/ports/IChatProvider.js';

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
            console.warn('[BullMQWorker] Worker já está rodando.');
            return;
        }

        console.log(`[BullMQWorker] Iniciando escuta na fila: ${this.queueName}`);

        this.worker = new Worker(
            this.queueName,
            async (job: Job) => {
                const { workspaceId, threadId, content, source } = job.data;
                console.log(`[BullMQWorker] Processando job ${job.id} para thread ${threadId} (origem: ${source})`);

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
            console.log(`[BullMQWorker] Job ${job.id} processado com sucesso.`);
        });

        this.worker.on('failed', (job, err) => {
            console.error(`[BullMQWorker] Job ${job?.id} falhou:`, err);
        });

        this.worker.on('error', (err) => {
            console.error('[BullMQWorker] Erro crítico no worker:', err);
        });
    }

    async stop(): Promise<void> {
        if (this.worker) {
            console.log('[BullMQWorker] Parando escuta da fila...');
            await this.worker.close();
            this.worker = null;
            console.log('[BullMQWorker] Worker parado com sucesso.');
        }
    }
}
