import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQWorker } from './BullMQWorker.js';
import { Worker } from 'bullmq';
import type { ProcessAgentResponseUse } from '../../usecases/ProcessAgentResponseUseCase.js';
import type { IChatProvider } from '../../domain/ports/IChatProvider.js';

const mockWorkerOn = vi.fn();
vi.mock('bullmq', () => {
    return {
        Worker: vi.fn().mockImplementation(function () {
            return {
                on: mockWorkerOn,
                close: vi.fn().mockResolvedValue(undefined),
            };
        }),
    };
});

describe('BullMQWorker', () => {
    let mockProcessUseCase: ProcessAgentResponseUse;
    let mockChatProviders: Record<string, IChatProvider>;
    let mockChatProvider: IChatProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        mockProcessUseCase = {
            execute: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessAgentResponseUse;
        mockChatProvider = {
            sendMessage: vi.fn().mockResolvedValue(undefined),
        } as unknown as IChatProvider;
        mockChatProviders = {
            slack: mockChatProvider,
        };
    });

    it('deve instanciar o Worker com as opções corretas', () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new BullMQWorker(mockRedisConnection, mockProcessUseCase, mockChatProviders, 'test-queue');

        worker.start();

        expect(Worker).toHaveBeenCalledOnce();
        
        const [name, processor, options] = vi.mocked(Worker).mock.calls[0];
        expect(name).toBe('test-queue');
        expect(processor).toBeTypeOf('function');
        expect(options?.connection).toEqual(mockRedisConnection);
    });

    it('deve processar o job chamando execute no use case correspondente', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new BullMQWorker(mockRedisConnection, mockProcessUseCase, mockChatProviders, 'test-queue');

        worker.start();

        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        const mockJob = {
            id: 'job-1',
            data: {
                workspaceId: 'space-abc',
                threadId: 'thread-xyz',
                content: 'Olá mundo',
                source: 'slack',
            },
        };

        await processor(mockJob);

        expect(mockProcessUseCase.execute).toHaveBeenCalledWith(
            'space-abc',
            'thread-xyz',
            'Olá mundo',
            mockChatProvider
        );
    });

    it('deve lançar erro se o chat provider não for conhecido', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new BullMQWorker(mockRedisConnection, mockProcessUseCase, mockChatProviders, 'test-queue');

        worker.start();

        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        const mockJob = {
            id: 'job-1',
            data: {
                workspaceId: 'space-abc',
                threadId: 'thread-xyz',
                content: 'Olá mundo',
                source: 'unknown-source',
            },
        };

        await expect(processor(mockJob)).rejects.toThrow('Chat provider desconhecido: unknown-source');
    });
});
