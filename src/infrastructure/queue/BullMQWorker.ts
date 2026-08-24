import { SpanKind } from '@opentelemetry/api';
import { Worker, type Job } from 'bullmq';
import type { ProcessAgentResponseUse } from '../../usecases/ProcessAgentResponseUseCase.js';
import type { IChatProvider } from '../../domain/ports/IChatProvider.js';
import { logger } from '../../config/logger.js';
import type { ChatProviderFactory } from '../chat/ChatProviderFactory.js';
import { extractTraceContext } from '../tracing/TraceContext.js';
import { withContext, withSpan } from '../tracing/TracerProvider.js';

const log = logger.child({ module: 'BullMQWorker' });

export class BullMQWorker {
    private worker: Worker | null = null;

    constructor(
        private readonly redisConnection: any,
        private readonly processUseCase: ProcessAgentResponseUse,
        private readonly chatProviders: Record<string, IChatProvider>,
        private readonly queueName: string = 'message-processing',
        private readonly chatProviderFactory?: ChatProviderFactory
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
                const { workspaceId, threadId, content, source, traceContext } = job.data;
                const parentContext = extractTraceContext(traceContext);

                await withContext(parentContext, async () => {
                    await withSpan(
                        'bullmq.process_job',
                        {
                            kind: SpanKind.CONSUMER,
                            attributes: {
                                'messaging.system': 'bullmq',
                                'messaging.destination': this.queueName,
                                'messaging.job_id': job.id,
                                'app.workspace_id': workspaceId,
                                'app.thread_id': threadId,
                                'app.source': source,
                            },
                        },
                        async () => {
                            log.info({ jobId: job.id, threadId, source }, 'Processando job.');

                            const chatProvider = this.chatProviderFactory
                                ? await this.chatProviderFactory.getProvider(workspaceId, source)
                                : this.chatProviders[source];

                            if (!chatProvider) {
                                throw new Error(`Chat provider desconhecido: ${source}`);
                            }

                            // Dispara o caso de uso (Orquestração do agente)
                            await this.processUseCase.execute(workspaceId, threadId, content, chatProvider);
                        }
                    );
                });
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
