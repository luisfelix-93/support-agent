import crypto from "crypto";
import { Worker, type Job } from "bullmq";
import { SpanKind } from "@opentelemetry/api";
import type { ITenantRepository } from "../../domain/ports/ITenantRepository.js";
import type { IMemoryRepository } from "../../domain/ports/IMemoryRepository.js";
import type { IMemoryExtractor } from "../../domain/ports/IMemoryExtractor.js";
import type { IEmbeddingProvider } from "../../domain/ports/IEmbeddingProvider.js";
import { LLMFactory } from "../llm/LLMFactory.js";
import { Message, type MessageRole } from "../../domain/Message.js";
import type { Memory } from "../../domain/Memory.js";
import { logger } from "../../config/logger.js";
import { extractTraceContext } from "../tracing/TraceContext.js";
import { withContext, withSpan } from "../tracing/TracerProvider.js";

const log = logger.child({ module: 'MemoryPromotionWorker' });

export interface MemoryPromotionPayload {
    tenantId: string;
    workspaceId: string;
    threadId: string;
    messages: Array<{ role: MessageRole; content: string }>;
    traceContext?: Record<string, string>;
}

export class MemoryPromotionWorker {
    private worker: Worker | null = null;

    constructor(
        private readonly redisConnection: any,
        private readonly tenantRepository: ITenantRepository,
        private readonly memoryExtractor: IMemoryExtractor,
        private readonly memoryRepository: IMemoryRepository,
        private readonly embeddingProvider?: IEmbeddingProvider,
        private readonly queueName: string = 'memory-promotion'
    ) {}

    start(): void {
        if (this.worker) {
            log.warn('Worker de promoção de memória já está rodando.');
            return;
        }

        log.info({ queueName: this.queueName }, 'Iniciando worker de promoção de memória.');

        this.worker = new Worker(
            this.queueName,
            async (job: Job<MemoryPromotionPayload>) => {
                const { tenantId, workspaceId, threadId, messages, traceContext } = job.data;
                const parentContext = extractTraceContext(traceContext);

                await withContext(parentContext, async () => {
                    await withSpan(
                        'bullmq.process_memory_promotion',
                        {
                            kind: SpanKind.CONSUMER,
                            attributes: {
                                'messaging.system': 'bullmq',
                                'messaging.destination': this.queueName,
                                'messaging.job_id': job.id,
                                'app.tenant_id': tenantId,
                                'app.workspace_id': workspaceId,
                                'app.thread_id': threadId,
                            },
                        },
                        async () => {
                            log.info({ jobId: job.id, tenantId, workspaceId }, 'Processando job de promoção de memória.');

                            const tenant = await this.tenantRepository.findByWorkspaceId(workspaceId);
                            if (!tenant || !tenant.isActive) {
                                log.warn({ workspaceId }, 'Tenant não encontrado ou inativo para promoção de memória.');
                                return;
                            }

                            const llmProvider = LLMFactory.create(tenant.llmConfig);
                            const domainMessages = (messages || []).map(
                                m => new Message(crypto.randomUUID(), m.role, m.content)
                            );

                            const extractedMemories = await this.memoryExtractor.extract({
                                tenantId,
                                workspaceId,
                                threadId,
                                messages: domainMessages,
                                llmProvider,
                            });

                            if (extractedMemories.length === 0) {
                                log.info({ jobId: job.id }, 'Nenhuma memória de longo prazo identificada.');
                                return;
                            }

                            // Deduplicação e Idempotência: filtra memórias que já existem com mesmo conteúdo
                            const memoriesToSave: Memory[] = [];
                            for (const memory of extractedMemories) {
                                const existing = await this.memoryRepository.searchRelevant({
                                    tenantId,
                                    workspaceId,
                                    query: memory.content,
                                    limit: 1,
                                });

                                const isDuplicate = existing.some(
                                    e => e.content.trim().toLowerCase() === memory.content.trim().toLowerCase()
                                );

                                if (!isDuplicate) {
                                    memoriesToSave.push(memory);
                                } else {
                                    log.debug({ content: memory.content }, 'Memória duplicada ignorada.');
                                }
                            }

                            // Geração de embeddings vetoriais (Fase 6)
                            if (this.embeddingProvider && memoriesToSave.length > 0) {
                                try {
                                    const contents = memoriesToSave.map(m => m.content);
                                    const embeddings = await this.embeddingProvider.generateEmbeddings(contents);
                                    for (let i = 0; i < memoriesToSave.length; i++) {
                                        if (embeddings[i] && embeddings[i].length > 0) {
                                            memoriesToSave[i].embedding = embeddings[i];
                                        }
                                    }
                                } catch (embError) {
                                    log.warn({ err: embError }, 'Falha ao gerar embeddings para as memórias. Salvando sem embeddings.');
                                }
                            }

                            if (memoriesToSave.length > 0) {
                                await this.memoryRepository.saveBatch(memoriesToSave);
                                log.info(
                                    { savedCount: memoriesToSave.length, jobId: job.id },
                                    'Memórias de longo prazo promovidas e salvas com sucesso.'
                                );
                            }
                        }
                    );
                });
            },
            {
                connection: this.redisConnection,
                concurrency: Number(process.env.MEMORY_WORKER_CONCURRENCY) || 2,
            }
        );

        this.worker.on('completed', (job) => {
            log.info({ jobId: job.id }, 'Job de promoção de memória processado com sucesso.');
        });

        this.worker.on('failed', (job, err) => {
            log.error({ err, jobId: job?.id }, 'Job de promoção de memória falhou.');
        });

        this.worker.on('error', (err) => {
            log.error({ err }, 'Erro no worker de promoção de memória.');
        });
    }

    async stop(): Promise<void> {
        if (this.worker) {
            log.info('Parando worker de promoção de memória...');
            await this.worker.close();
            this.worker = null;
            log.info('Worker de promoção de memória parado com sucesso.');
        }
    }
}
