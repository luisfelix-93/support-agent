import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationController } from './EvaluationController.js';
import type { IEvaluationRepository } from '../domain/ports/IEvaluationRepository.js';
import type { AggregationService } from '../evaluation/AggregationService.js';
import { EvaluationResult } from '../domain/EvaluationResult.js';

describe('EvaluationController', () => {
    let evaluationRepository: IEvaluationRepository;
    let aggregationService: AggregationService;
    let controller: EvaluationController;

    const mockResponse = () => {
        const res: any = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    };

    const dummyResult = new EvaluationResult(
        'run-test-1',
        'tenant-1',
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
            costUsd: 0.001,
            memoriesInjected: 1,
            contextUtilization: 0.2,
        },
        {
            confidence: 0.95,
            hallucinationRisk: 0.05,
            contextRelevance: 0.9,
            completeness: 1.0,
            toolSelectionQuality: 1.0,
        },
        0.95
    );

    beforeEach(() => {
        evaluationRepository = {
            createIndexes: vi.fn(),
            save: vi.fn(),
            findByRunId: vi.fn(),
            findByTenant: vi.fn(),
            aggregateByVersion: vi.fn(),
            aggregateByTenant: vi.fn(),
        };

        aggregationService = {
            getVersionStats: vi.fn(),
            compareVersions: vi.fn(),
            detectRegression: vi.fn(),
            getTenantSummary: vi.fn(),
        } as any;

        controller = new EvaluationController(evaluationRepository, aggregationService);
    });

    describe('getByRunId', () => {
        it('deve retornar 404 se a avaliação não for encontrada', async () => {
            vi.mocked(evaluationRepository.findByRunId).mockResolvedValueOnce(null);
            const req: any = { params: { runId: 'run-not-found' } };
            const res = mockResponse();

            await controller.getByRunId(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
        });

        it('deve retornar 200 com a avaliação quando encontrada', async () => {
            vi.mocked(evaluationRepository.findByRunId).mockResolvedValueOnce(dummyResult);
            const req: any = { params: { runId: 'run-test-1' } };
            const res = mockResponse();

            await controller.getByRunId(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: dummyResult });
        });

        it('deve retornar 500 em caso de exceção no repositório', async () => {
            vi.mocked(evaluationRepository.findByRunId).mockRejectedValueOnce(new Error('DB Error'));
            const req: any = { params: { runId: 'run-err' } };
            const res = mockResponse();

            await controller.getByRunId(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('listByTenant', () => {
        it('deve retornar 400 se tenantId não for fornecido', async () => {
            const req: any = { query: {} };
            const res = mockResponse();

            await controller.listByTenant(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('tenantId') }));
        });

        it('deve retornar 200 com lista de avaliações paginada', async () => {
            vi.mocked(evaluationRepository.findByTenant).mockResolvedValueOnce([dummyResult]);
            const req: any = {
                query: {
                    tenantId: 'tenant-1',
                    limit: '10',
                    skip: '5',
                    agentVersion: '1.0.0',
                },
            };
            const res = mockResponse();

            await controller.listByTenant(req, res);

            expect(evaluationRepository.findByTenant).toHaveBeenCalledWith('tenant-1', {
                limit: 10,
                skip: 5,
                from: undefined,
                to: undefined,
                agentVersion: '1.0.0',
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({
                success: true,
                count: 1,
                limit: 10,
                skip: 5,
                data: [dummyResult],
            });
        });
    });

    describe('getVersionStats', () => {
        it('deve retornar 200 com as estatísticas agregadas da versão', async () => {
            const stats = {
                version: '1.0.0',
                totalRuns: 40,
                avgCompositeScore: 0.93,
                avgConfidence: 0.95,
                avgHallucinationRisk: 0.05,
                avgToolSuccessRate: 1.0,
                avgCostUsd: 0.001,
                avgLatencyMs: 1200,
                totalCostUsd: 0.04,
                totalTokens: 6000,
                period: { from: null, to: null },
            };
            vi.mocked(aggregationService.getVersionStats).mockResolvedValueOnce(stats);

            const req: any = { params: { version: '1.0.0' } };
            const res = mockResponse();

            await controller.getVersionStats(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: stats });
        });
    });

    describe('compareVersions', () => {
        it('deve retornar 400 se versionA ou versionB não forem informados', async () => {
            const req: any = { query: { versionA: '1.0.0' } };
            const res = mockResponse();

            await controller.compareVersions(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('obrigatórios') }));
        });

        it('deve retornar 200 com o resultado da comparação entre versões', async () => {
            const comparisonResult = {
                versionA: { version: '1.0.0' } as any,
                versionB: { version: '1.1.0' } as any,
                deltas: {},
                regressions: [],
                improvements: ['avgCompositeScore'],
            };
            vi.mocked(aggregationService.compareVersions).mockResolvedValueOnce(comparisonResult);

            const req: any = { query: { versionA: '1.0.0', versionB: '1.1.0', threshold: '0.05' } };
            const res = mockResponse();

            await controller.compareVersions(req, res);

            expect(aggregationService.compareVersions).toHaveBeenCalledWith('1.0.0', '1.1.0', 0.05);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: comparisonResult });
        });
    });

    describe('detectRegression', () => {
        it('deve retornar 400 se currentVersion ou previousVersion não forem informados', async () => {
            const req: any = { query: { currentVersion: '2.0.0' } };
            const res = mockResponse();

            await controller.detectRegression(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('deve retornar 200 com o relatório de regressão', async () => {
            const report = {
                hasRegression: false,
                currentVersion: '2.0.0',
                previousVersion: '1.0.0',
                threshold: 0.1,
                regressions: [],
            };
            vi.mocked(aggregationService.detectRegression).mockResolvedValueOnce(report);

            const req: any = { query: { currentVersion: '2.0.0', previousVersion: '1.0.0' } };
            const res = mockResponse();

            await controller.detectRegression(req, res);

            expect(aggregationService.detectRegression).toHaveBeenCalledWith('2.0.0', '1.0.0', 0.1);
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: report });
        });
    });

    describe('getTenantSummary', () => {
        it('deve retornar 200 com o resumo do tenant', async () => {
            const summary = {
                tenantId: 'tenant-acme',
                from: new Date('2026-09-01'),
                to: new Date('2026-09-07'),
                totalRuns: 15,
                avgCompositeScore: 0.91,
                avgConfidence: 0.94,
                avgHallucinationRisk: 0.04,
                avgToolSuccessRate: 1.0,
                totalCostUsd: 0.015,
                totalTokens: 3000,
                avgLatencyMs: 1100,
            };
            vi.mocked(aggregationService.getTenantSummary).mockResolvedValueOnce(summary);

            const req: any = {
                params: { tenantId: 'tenant-acme' },
                query: { from: '2026-09-01', to: '2026-09-07' },
            };
            const res = mockResponse();

            await controller.getTenantSummary(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ success: true, data: summary });
        });
    });
});
