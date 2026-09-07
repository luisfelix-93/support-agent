import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQAdapter } from './BullMQAdapter.js';
import { Queue } from 'bullmq';
import type { MessageRole } from '../../domain/Message.js';

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
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-msg-queue', 'test-mem-queue', 'test-eval-queue');

        await expect(
            adapter.dispatchMessageProcessing('workspace-123', 'thread-456', 'conteúdo de teste', 'slack')
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledTimes(3);
        
        const messageQueueInstance = vi.mocked(Queue).mock.results[0].value;
        expect(messageQueueInstance.add).toHaveBeenCalledWith(
            'process-message',
            expect.objectContaining({
                workspaceId: 'workspace-123',
                threadId: 'thread-456',
                content: 'conteúdo de teste',
                source: 'slack',
            }),
            expect.objectContaining({
                jobId: expect.any(String),
            })
        );
    });

    it('deve adicionar o job na fila de promoção de memória com os parâmetros corretos', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-msg-queue', 'test-mem-queue', 'test-eval-queue');

        const messages: Array<{ role: MessageRole; content: string }> = [
            { role: 'user', content: 'Qual o host do PostgreSQL?' },
            { role: 'assistant', content: 'O host é db.internal.' }
        ];

        await expect(
            adapter.dispatchMemoryPromotion('tenant-123', 'workspace-456', 'thread-789', messages)
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledTimes(3);

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

    it('deve adicionar o job na fila de auto-avaliação com os parâmetros corretos', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const adapter = new BullMQAdapter(mockRedisConnection, 'test-msg-queue', 'test-mem-queue', 'test-eval-queue');

        await expect(
            adapter.dispatchEvaluation('run-123', 'tenant-123', 'workspace-456', {
                threadId: 'thread-789',
                userMessage: 'Olá',
                finalResponse: 'Tudo bem!',
                iterations: 1,
                toolCalls: [],
                totalTokens: 150,
                costUsd: 0.0005,
                durationMs: 250,
                memoriesInjected: 2,
                agentVersion: '1.0.0',
            })
        ).resolves.toBeUndefined();

        expect(Queue).toHaveBeenCalledTimes(3);

        const evalQueueInstance = vi.mocked(Queue).mock.results[2].value;
        expect(evalQueueInstance.add).toHaveBeenCalledWith(
            'evaluate-run',
            expect.objectContaining({
                runId: 'run-123',
                tenantId: 'tenant-123',
                workspaceId: 'workspace-456',
                userMessage: 'Olá',
                finalResponse: 'Tudo bem!',
                totalTokens: 150,
                costUsd: 0.0005,
            })
        );
    });
});
