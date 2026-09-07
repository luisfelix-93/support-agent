import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationRepository } from './EvaluationRepository.js';
import { EvaluationResult } from '../domain/EvaluationResult.js';
import { MongoConnection } from '../infrastructure/database/MongoConnection.js';

describe('EvaluationRepository', () => {
    let repository: EvaluationRepository;
    let mockCollection: any;

    beforeEach(() => {
        mockCollection = {
            createIndex: vi.fn().mockResolvedValue('index-created'),
            updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
            findOne: vi.fn(),
            find: vi.fn(),
        };

        vi.spyOn(MongoConnection, 'getDb').mockReturnValue({
            collection: vi.fn().mockReturnValue(mockCollection),
        } as any);

        repository = new EvaluationRepository();
    });

    const createDummyResult = (runId = 'run-1', tenantId = 'tenant-1', score = 0.85, date = new Date()) => {
        return new EvaluationResult(
            runId,
            tenantId,
            'ws-1',
            '1.0.0',
            {
                durationMs: 1200,
                iterations: 1,
                toolCallsTotal: 1,
                toolCallsFailed: 0,
                toolSuccessRate: 1.0,
                totalInputTokens: 100,
                totalOutputTokens: 50,
                totalTokens: 150,
                costUsd: 0.0015,
                memoriesInjected: 1,
                contextUtilization: 0.15,
            },
            {
                confidence: 0.9,
                hallucinationRisk: 0.1,
                contextRelevance: 0.85,
                completeness: 0.95,
                toolSelectionQuality: 1.0,
                reasoning: 'Resposta bem fundamentada.',
            },
            score,
            date
        );
    };

    it('deve criar os 3 índices necessários no MongoDB', async () => {
        await repository.createIndexes();

        expect(mockCollection.createIndex).toHaveBeenCalledTimes(3);
        expect(mockCollection.createIndex).toHaveBeenCalledWith({ runId: 1 }, { unique: true });
        expect(mockCollection.createIndex).toHaveBeenCalledWith({ tenantId: 1, evaluatedAt: -1 });
        expect(mockCollection.createIndex).toHaveBeenCalledWith({ agentVersion: 1 });
    });

    it('deve salvar EvaluationResult com upsert usando runId como chave', async () => {
        const result = createDummyResult('run-123', 'tenant-abc', 0.92);

        await repository.save(result);

        expect(mockCollection.updateOne).toHaveBeenCalledWith(
            { runId: 'run-123' },
            {
                $set: expect.objectContaining({
                    runId: 'run-123',
                    tenantId: 'tenant-abc',
                    compositeScore: 0.92,
                    agentVersion: '1.0.0',
                }),
            },
            { upsert: true }
        );
    });

    it('deve retornar EvaluationResult mapeado ao buscar por runId existente', async () => {
        const dummyDate = new Date('2026-09-07T12:00:00Z');
        mockCollection.findOne.mockResolvedValueOnce({
            runId: 'run-456',
            tenantId: 'tenant-xyz',
            workspaceId: 'ws-1',
            agentVersion: '1.0.0',
            passive: {
                durationMs: 800,
                iterations: 0,
                toolCallsTotal: 0,
                toolCallsFailed: 0,
                toolSuccessRate: 1.0,
                totalInputTokens: 80,
                totalOutputTokens: 20,
                totalTokens: 100,
                costUsd: 0.0005,
                memoriesInjected: 0,
                contextUtilization: 0.1,
            },
            selfEval: {
                confidence: 0.95,
                hallucinationRisk: 0.05,
                contextRelevance: 1.0,
                completeness: 0.9,
                toolSelectionQuality: 1.0,
            },
            compositeScore: 0.94,
            evaluatedAt: dummyDate,
        });

        const result = await repository.findByRunId('run-456');

        expect(result).toBeInstanceOf(EvaluationResult);
        expect(result?.runId).toBe('run-456');
        expect(result?.compositeScore).toBe(0.94);
        expect(result?.evaluatedAt).toEqual(dummyDate);
    });

    it('deve retornar null ao buscar runId inexistente', async () => {
        mockCollection.findOne.mockResolvedValueOnce(null);

        const result = await repository.findByRunId('run-nonexistent');
        expect(result).toBeNull();
    });

    it('deve filtrar avaliações por tenant, versão, intervalo de datas e paginação', async () => {
        const mockCursor = {
            sort: vi.fn().mockReturnThis(),
            skip: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            toArray: vi.fn().mockResolvedValue([
                {
                    runId: 'run-filtered-1',
                    tenantId: 'tenant-1',
                    workspaceId: 'ws-1',
                    agentVersion: '2.0.0',
                    passive: {
                        durationMs: 1000,
                        iterations: 1,
                        toolCallsTotal: 0,
                        toolCallsFailed: 0,
                        toolSuccessRate: 1.0,
                        totalInputTokens: 50,
                        totalOutputTokens: 25,
                        totalTokens: 75,
                        costUsd: 0.0003,
                        memoriesInjected: 0,
                        contextUtilization: 0.05,
                    },
                    selfEval: {
                        confidence: 0.88,
                        hallucinationRisk: 0.12,
                        contextRelevance: 0.9,
                        completeness: 0.85,
                        toolSelectionQuality: 1.0,
                    },
                    compositeScore: 0.89,
                    evaluatedAt: new Date(),
                },
            ]),
        };
        mockCollection.find.mockReturnValue(mockCursor);

        const from = new Date('2026-09-01T00:00:00Z');
        const to = new Date('2026-09-07T23:59:59Z');

        const results = await repository.findByTenant('tenant-1', {
            agentVersion: '2.0.0',
            from,
            to,
            skip: 10,
            limit: 5,
        });

        expect(mockCollection.find).toHaveBeenCalledWith({
            tenantId: 'tenant-1',
            agentVersion: '2.0.0',
            evaluatedAt: {
                $gte: from,
                $lte: to,
            },
        });
        expect(mockCursor.sort).toHaveBeenCalledWith({ evaluatedAt: -1 });
        expect(mockCursor.skip).toHaveBeenCalledWith(10);
        expect(mockCursor.limit).toHaveBeenCalledWith(5);
        expect(results).toHaveLength(1);
        expect(results[0].runId).toBe('run-filtered-1');
    });
});
