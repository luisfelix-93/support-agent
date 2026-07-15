import { Queue } from 'bullmq';
import type { IQueueService } from "../../domain/ports/IQueueService.js";

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
        console.log(`[BullMQAdapter] Enfileirando mensagem para workspace: ${workspaceId}, thread: ${threadId}, source: ${source}`);
        try {
            await this.queue.add('process-message', {
                workspaceId,
                threadId,
                content,
                source,
            });
        } catch (error) {
            console.error('[BullMQAdapter] Erro ao enfileirar mensagem:', error);
            throw error;
        }
    }
}
