import { describe, it, expect, vi } from 'vitest';
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
    it('deve adicionar o job na fila com os parâmetros corretos', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-queue');

        await expect(
            adapter.dispatchMessageProcessing('workspace-123', 'thread-456', 'conteúdo de teste', 'slack')
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledOnce();
        
        const queueInstance = vi.mocked(Queue).mock.results[0].value;
        expect(queueInstance.add).toHaveBeenCalledWith('process-message', {
            workspaceId: 'workspace-123',
            threadId: 'thread-456',
            content: 'conteúdo de teste',
            source: 'slack',
        });
    });
});
