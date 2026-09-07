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
            aggregate: vi.fn(),
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
            expect(mockCollection.createIndex).toHaveBeenCalledWith({ tenantId: 1, status: 1, startedAt: -1 });
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

        it('deve filtrar por status, data inicial e final quando fornecidos', async () => {
            const from = new Date('2026-09-01T00:00:00Z');
            const to = new Date('2026-09-07T23:59:59Z');

            const mockCursor = {
                sort: vi.fn().mockReturnThis(),
                skip: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                toArray: vi.fn().mockResolvedValueOnce([]),
            };

            mockCollection.find.mockReturnValue(mockCursor);

            await repository.findByTenant('tenant-abc', {
                status: 'completed',
                from,
                to,
                limit: 20,
                offset: 0,
            });

            expect(mockCollection.find).toHaveBeenCalledWith({
                tenantId: 'tenant-abc',
                status: 'completed',
                startedAt: {
                    $gte: from,
                    $lte: to,
                },
            });
        });
    });

    describe('aggregateCostByTenant', () => {
        it('deve agregar custos por tenant aplicando projeção e group', async () => {
            const from = new Date('2026-09-01T00:00:00Z');
            const to = new Date('2026-09-07T23:59:59Z');

            const mockAggResult = [
                {
                    _id: 'tenant-abc',
                    totalRuns: 10,
                    totalCostUsd: 0.123456,
                    avgCostUsd: 0.012345,
                    totalTokens: 5000,
                    totalInputTokens: 3500,
                    totalOutputTokens: 1500,
                    avgDurationMs: 1200,
                },
            ];

            const mockCursor = {
                toArray: vi.fn().mockResolvedValueOnce(mockAggResult),
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const result = await repository.aggregateCostByTenant('tenant-abc', from, to);

            expect(mockCollection.aggregate).toHaveBeenCalled();
            const pipeline = mockCollection.aggregate.mock.calls[0][0];
            expect(pipeline[0]).toEqual({
                $match: {
                    tenantId: 'tenant-abc',
                    startedAt: { $gte: from, $lte: to },
                },
            });

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                tenantId: 'tenant-abc',
                totalRuns: 10,
                totalCostUsd: 0.123456,
                avgCostUsd: 0.012345,
                totalTokens: 5000,
                totalInputTokens: 3500,
                totalOutputTokens: 1500,
                avgDurationMs: 1200,
            });
        });

        it('deve funcionar sem filtros de tenant e data', async () => {
            const mockCursor = {
                toArray: vi.fn().mockResolvedValueOnce([]),
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const result = await repository.aggregateCostByTenant();

            expect(mockCollection.aggregate).toHaveBeenCalled();
            expect(result).toEqual([]);
        });
    });

    describe('aggregateToolAnalytics', () => {
        it('deve agregar analytics de ferramentas com cálculo de taxa de sucesso', async () => {
            const mockAggResult = [
                {
                    _id: 'k8s_cluster_status',
                    totalCalls: 20,
                    failedCalls: 2,
                    avgDurationMs: 450,
                },
                {
                    _id: 'get_logs',
                    totalCalls: 10,
                    failedCalls: 0,
                    avgDurationMs: 250,
                },
            ];

            const mockCursor = {
                toArray: vi.fn().mockResolvedValueOnce(mockAggResult),
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const result = await repository.aggregateToolAnalytics('tenant-abc');

            expect(mockCollection.aggregate).toHaveBeenCalled();
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                toolName: 'k8s_cluster_status',
                totalCalls: 20,
                successfulCalls: 18,
                failedCalls: 2,
                successRate: 0.9,
                avgDurationMs: 450,
            });
            expect(result[1]).toEqual({
                toolName: 'get_logs',
                totalCalls: 10,
                successfulCalls: 10,
                failedCalls: 0,
                successRate: 1,
                avgDurationMs: 250,
            });
        });
    });

    describe('aggregateLLMAnalytics', () => {
        it('deve agregar analytics de chamadas LLM agrupadas por provider e modelo', async () => {
            const mockAggResult = [
                {
                    _id: { provider: 'openai', model: 'gpt-4o' },
                    totalCalls: 15,
                    totalInputTokens: 10000,
                    totalOutputTokens: 3000,
                    totalTokens: 13000,
                    totalCostUsd: 0.05,
                    avgLatencyMs: 650,
                },
            ];

            const mockCursor = {
                toArray: vi.fn().mockResolvedValueOnce(mockAggResult),
            };
            mockCollection.aggregate.mockReturnValue(mockCursor);

            const result = await repository.aggregateLLMAnalytics();

            expect(mockCollection.aggregate).toHaveBeenCalled();
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                provider: 'openai',
                model: 'gpt-4o',
                totalCalls: 15,
                totalInputTokens: 10000,
                totalOutputTokens: 3000,
                totalTokens: 13000,
                totalCostUsd: 0.05,
                avgLatencyMs: 650,
            });
        });
    });
});

