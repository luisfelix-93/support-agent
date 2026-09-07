import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRunRepository } from './AgentRunRepository.js';
import { AgentRun } from '../domain/AgentRun.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

vi.mock('../infrastructure/database/MongoConnection.js', () => ({
    MongoConnection: {
        getDb: vi.fn(),
    },
}));

describe('AgentRunRepository', () => {
    let mockCollection: any;
    let repository: AgentRunRepository;

    beforeEach(() => {
        vi.clearAllMocks();

        mockCollection = {
            findOne: vi.fn(),
            find: vi.fn(),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
            createIndex: vi.fn().mockResolvedValue('index-created'),
        };

        vi.mocked(MongoConnection.getDb).mockReturnValue({
            collection: vi.fn().mockReturnValue(mockCollection),
        } as any);

        repository = new AgentRunRepository();
    });

    describe('createIndexes', () => {
        it('deve criar índices únicos e compostos', async () => {
            await repository.createIndexes();

            expect(mockCollection.createIndex).toHaveBeenCalledWith({ runId: 1 }, { unique: true });
            expect(mockCollection.createIndex).toHaveBeenCalledWith({ tenantId: 1, startedAt: -1 });
        });
    });

    describe('save', () => {
        it('deve persistir o AgentRun com upsert baseado em runId', async () => {
            const run = new AgentRun('run-123', 'tenant-abc', 'ws-xyz', 'thread-789');
            run.userMessage = 'Olá mundo';
            run.finalResponse = 'Resposta do agente';
            run.recordLLMCall({
                provider: 'openai',
                model: 'gpt-4o',
                inputTokens: 150,
                outputTokens: 75,
                totalTokens: 225,
                latencyMs: 350,
                resultType: 'text',
                costUsd: 0.001125,
            });
            run.finish('completed');

            await repository.save(run);

            expect(mockCollection.updateOne).toHaveBeenCalledWith(
                { runId: 'run-123' },
                {
                    $set: expect.objectContaining({
                        runId: 'run-123',
                        tenantId: 'tenant-abc',
                        workspaceId: 'ws-xyz',
                        threadId: 'thread-789',
                        status: 'completed',
                        totalTokens: 225,
                        costUsd: 0.001125,
                        finalResponse: 'Resposta do agente',
                        userMessage: 'Olá mundo',
                        llmCalls: expect.arrayContaining([
                            expect.objectContaining({ model: 'gpt-4o', totalTokens: 225 })
                        ]),
                    }),
                },
                { upsert: true }
            );
        });
    });

    describe('findByRunId', () => {
        it('deve retornar AgentRun quando encontrado', async () => {
            mockCollection.findOne.mockResolvedValueOnce({
                runId: 'run-123',
                tenantId: 'tenant-abc',
                workspaceId: 'ws-xyz',
                threadId: 'thread-789',
                status: 'completed',
                iterations: 2,
                toolCalls: [],
                llmCalls: [],
                totalTokens: 500,
                costUsd: 0.002,
                startedAt: new Date(),
                completedAt: new Date(),
            });

            const result = await repository.findByRunId('run-123');

            expect(mockCollection.findOne).toHaveBeenCalledWith({ runId: 'run-123' });
            expect(result).toBeInstanceOf(AgentRun);
            expect(result?.id).toBe('run-123');
            expect(result?.totalTokens).toBe(500);
            expect(result?.costUsd).toBe(0.002);
        });

        it('deve retornar null quando não encontrado', async () => {
            mockCollection.findOne.mockResolvedValueOnce(null);

            const result = await repository.findByRunId('run-non-existent');

            expect(result).toBeNull();
        });
    });

    describe('findByTenant', () => {
        it('deve buscar runs do tenant com paginação e ordenação decrescente', async () => {
            const mockCursor = {
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValueOnce([
                    {
                        runId: 'run-1',
                        tenantId: 'tenant-abc',
                        workspaceId: 'ws-xyz',
                        threadId: 'thread-1',
                        status: 'completed',
                        totalTokens: 100,
                    },
                    {
                        runId: 'run-2',
                        tenantId: 'tenant-abc',
                        workspaceId: 'ws-xyz',
                        threadId: 'thread-2',
                        status: 'failed',
                        totalTokens: 50,
                    }
                ]),
            };

            mockCollection.find.mockReturnValue(mockCursor);

            const results = await repository.findByTenant('tenant-abc', { limit: 10, offset: 5 });

            expect(mockCollection.find).toHaveBeenCalledWith({ tenantId: 'tenant-abc' });
            expect(mockCursor.sort).toHaveBeenCalledWith({ startedAt: -1 });
            expect(mockCursor.skip).toHaveBeenCalledWith(5);
            expect(mockCursor.limit).toHaveBeenCalledWith(10);
            expect(results).toHaveLength(2);
            expect(results[0]).toBeInstanceOf(AgentRun);
            expect(results[0].id).toBe('run-1');
        });
    });
});
