import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryPromotionWorker } from './MemoryPromotionWorker.js';
import { Worker } from 'bullmq';
import type { ITenantRepository } from '../../domain/ports/ITenantRepository.js';
import type { IMemoryRepository } from '../../domain/ports/IMemoryRepository.js';
import type { IMemoryExtractor } from '../../domain/ports/IMemoryExtractor.js';
import { Tenant } from '../../domain/Tenant.js';
import type { Memory } from '../../domain/Memory.js';

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

describe('MemoryPromotionWorker', () => {
    let mockTenantRepository: ITenantRepository;
    let mockMemoryExtractor: IMemoryExtractor;
    let mockMemoryRepository: IMemoryRepository;

    beforeEach(() => {
        vi.clearAllMocks();

        mockTenantRepository = {
            findByWorkspaceId: vi.fn(),
            save: vi.fn(),
        };

        mockMemoryExtractor = {
            extract: vi.fn(),
        };

        mockMemoryRepository = {
            save: vi.fn(),
            saveBatch: vi.fn().mockResolvedValue(undefined),
            searchRelevant: vi.fn().mockResolvedValue([]),
            findByTenantId: vi.fn().mockResolvedValue([]),
            findByWorkspaceId: vi.fn().mockResolvedValue([]),
            findById: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(true),
        };
    });

    it('deve inicializar o Worker com o nome da fila correto', () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new MemoryPromotionWorker(
            mockRedisConnection,
            mockTenantRepository,
            mockMemoryExtractor,
            mockMemoryRepository,
            'test-memory-queue'
        );

        worker.start();

        expect(Worker).toHaveBeenCalledOnce();
        const [name, processor, options] = vi.mocked(Worker).mock.calls[0];
        expect(name).toBe('test-memory-queue');
        expect(processor).toBeTypeOf('function');
        expect(options?.connection).toEqual(mockRedisConnection);
    });

    it('deve processar o job, extrair memórias e salvar no repositório deduplicado', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new MemoryPromotionWorker(
            mockRedisConnection,
            mockTenantRepository,
            mockMemoryExtractor,
            mockMemoryRepository,
            'test-memory-queue'
        );

        const tenant = new Tenant(
            'ws-1',
            { provider: 'google', apiKey: 'fake-api-key', model: 'gemini-2.0-flash' },
            { url: 'http://localhost:3000', apiKey: 'mcp-key' },
            true
        );

        vi.mocked(mockTenantRepository.findByWorkspaceId).mockResolvedValue(tenant);

        const extractedMemories: Memory[] = [
            {
                id: 'mem-1',
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                type: 'fact',
                content: 'PostgreSQL 15 em produção',
                importance: 0.9,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: 'mem-2',
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                type: 'preference',
                content: 'Já existe no banco',
                importance: 0.7,
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        ];

        vi.mocked(mockMemoryExtractor.extract).mockResolvedValue(extractedMemories);

        // Mock de busca para simular que 'Já existe no banco' é duplicata
        vi.mocked(mockMemoryRepository.searchRelevant).mockImplementation(async (input) => {
            if (input.query === 'Já existe no banco') {
                return [{
                    id: 'mem-existing',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    type: 'preference',
                    content: 'Já existe no banco',
                    importance: 0.7,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }];
            }
            return [];
        });

        worker.start();

        const processor = vi.mocked(Worker).mock.calls[0][1] as any;

        const mockJob = {
            id: 'job-1',
            data: {
                tenantId: 'tenant-1',
                workspaceId: 'ws-1',
                threadId: 'thread-1',
                messages: [
                    { role: 'user', content: 'Qual o banco?' },
                    { role: 'assistant', content: 'PostgreSQL 15.' }
                ],
            },
        };

        await processor(mockJob);

        expect(mockTenantRepository.findByWorkspaceId).toHaveBeenCalledWith('ws-1');
        expect(mockMemoryExtractor.extract).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            messages: expect.any(Array),
            llmProvider: expect.anything(),
        });

        expect(mockMemoryRepository.saveBatch).toHaveBeenCalledWith([extractedMemories[0]]);
    });

    it('não deve processar se o tenant estiver inativo ou não for encontrado', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new MemoryPromotionWorker(
            mockRedisConnection,
            mockTenantRepository,
            mockMemoryExtractor,
            mockMemoryRepository
        );

        vi.mocked(mockTenantRepository.findByWorkspaceId).mockResolvedValue(null);

        worker.start();

        const processor = vi.mocked(Worker).mock.calls[0][1] as any;
        const mockJob = {
            id: 'job-2',
            data: {
                tenantId: 'tenant-1',
                workspaceId: 'ws-inactive',
                threadId: 'thread-1',
                messages: [],
            },
        };

        await processor(mockJob);

        expect(mockMemoryExtractor.extract).not.toHaveBeenCalled();
        expect(mockMemoryRepository.saveBatch).not.toHaveBeenCalled();
    });

    it('deve parar o worker ao chamar stop()', async () => {
        const mockRedisConnection = { host: 'localhost', port: 6379 };
        const worker = new MemoryPromotionWorker(
            mockRedisConnection,
            mockTenantRepository,
            mockMemoryExtractor,
            mockMemoryRepository
        );

        worker.start();
        await worker.stop();

        const workerInstance = vi.mocked(Worker).mock.results[0].value;
        expect(workerInstance.close).toHaveBeenCalledOnce();
    });
});
