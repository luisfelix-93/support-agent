import { Queue } from 'bullmq';
import type { IQueueService } from '../../domain/ports/IQueueService.js';
import { logger } from '../../config/logger.js';
import { injectTraceContext } from '../tracing/TraceContext.js';

const log = logger.child({ module: 'BullMQAdapter' });

export class BullMQAdapter implements IQueueService {
    private readonly queue: Queue;

    constructor(
        redisConnection: any,
        queueName: string = 'message-processing'
    ) {
        this.queue = new Queue(queueName, {
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
            await this.queue.add('process-message', {
                workspaceId,
                threadId,
                content,
                source,
                traceContext,
            });
        } catch (error) {
            log.error({ err: error, workspaceId, threadId, source }, 'Erro ao enfileirar mensagem.');
            throw error;
        }
    }
}

