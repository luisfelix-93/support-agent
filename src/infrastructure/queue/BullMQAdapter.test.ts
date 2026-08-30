import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQAdapter } from './BullMQAdapter.js';
import { Queue } from 'bullmq';

vi.mock('bullmq', () => {
    return {
        Queue: vi.fn().mockImplementation(function () {
            return {
                add: vi.fn().mockResolvedValue({ id: 'job-123' }),
            };
        }),
    };
});

describe('BullMQAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deve adicionar o job na fila de mensagens com os parâmetros corretos', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-msg-queue', 'test-mem-queue');

        await expect(
            adapter.dispatchMessageProcessing('workspace-123', 'thread-456', 'conteúdo de teste', 'slack')
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledTimes(2);
        
        const messageQueueInstance = vi.mocked(Queue).mock.results[0].value;
        expect(messageQueueInstance.add).toHaveBeenCalledWith(
            'process-message',
            expect.objectContaining({
                workspaceId: 'workspace-123',
                threadId: 'thread-456',
                content: 'conteúdo de teste',
                source: 'slack',
            })
        );
    });

    it('deve adicionar o job na fila de promoção de memória com os parâmetros corretos', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-msg-queue', 'test-mem-queue');

        const messages = [
            { role: 'user', content: 'Qual o host do PostgreSQL?' },
            { role: 'assistant', content: 'O host é db.internal.' }
        ];

        await expect(
            adapter.dispatchMemoryPromotion('tenant-123', 'workspace-456', 'thread-789', messages)
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledTimes(2);

        const memoryQueueInstance = vi.mocked(Queue).mock.results[1].value;
        expect(memoryQueueInstance.add).toHaveBeenCalledWith(
            'promote-memory',
            expect.objectContaining({
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                threadId: 'thread-789',
                messages,
            })
        );
    });
});
