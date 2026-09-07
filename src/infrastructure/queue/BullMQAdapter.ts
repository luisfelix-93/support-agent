import crypto from 'crypto';
import { Queue } from 'bullmq';
import type { IQueueService } from '../../domain/ports/IQueueService.js';
import type { MessageRole } from '../../domain/Message.js';
import { logger } from '../../config/logger.js';
import { injectTraceContext } from '../tracing/TraceContext.js';

const log = logger.child({ module: 'BullMQAdapter' });

export class BullMQAdapter implements IQueueService {
    private readonly messageQueue: Queue;
    private readonly memoryQueue: Queue;

    constructor(
        redisConnection: any,
        messageQueueName: string = 'message-processing',
        memoryQueueName: string = 'memory-promotion'
    ) {
        this.messageQueue = new Queue(messageQueueName, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            },
        });

        this.memoryQueue = new Queue(memoryQueueName, {
            connection: redisConnection,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 3000,
                },
                removeOnComplete: true,
                removeOnFail: false,
            },
        });
    }

    async dispatchMessageProcessing(
        workspaceId: string,
        threadId: string,
        content: string,
        source: 'google' | 'slack'
    ): Promise<void> {
        log.info({ workspaceId, threadId, source }, 'Enfileirando mensagem para processamento.');
        try {
            const traceContext = injectTraceContext();
            const bucket = Math.floor(Date.now() / 5000);
            const jobId = crypto
                .createHash('sha256')
                .update(`${workspaceId}:${threadId}:${content}:${bucket}`)
                .digest('hex');

            await this.messageQueue.add(
                'process-message',
                {
                    workspaceId,
                    threadId,
                    content,
                    source,
                    traceContext,
                },
                { jobId }
            );
        } catch (error) {
            log.error({ err: error, workspaceId, threadId, source }, 'Erro ao enfileirar mensagem.');
            throw error;
        }
    }

    async dispatchMemoryPromotion(
        tenantId: string,
        workspaceId: string,
        threadId: string,
        messages: Array<{ role: MessageRole; content: string }>
    ): Promise<void> {
        log.info({ tenantId, workspaceId, threadId }, 'Enfileirando job de promoção de memória.');
        try {
            const traceContext = injectTraceContext();
            await this.memoryQueue.add('promote-memory', {
                tenantId,
                workspaceId,
                threadId,
                messages,
                traceContext,
            });
        } catch (error) {
            log.error({ err: error, tenantId, workspaceId, threadId }, 'Erro ao enfileirar promoção de memória.');
            throw error;
        }
    }
}
