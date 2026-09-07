import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AggregationService } from './AggregationService.js';
import type { IEvaluationRepository } from '../domain/ports/IEvaluationRepository.js';

describe('AggregationService', () => {
    let evaluationRepository: IEvaluationRepository;
    let service: AggregationService;

    beforeEach(() => {
        evaluationRepository = {
            createIndexes: vi.fn(),
            save: vi.fn(),
            findByRunId: vi.fn(),
            findByTenant: vi.fn(),
            aggregateByVersion: vi.fn(),
            aggregateByTenant: vi.fn(),
        };

        service = new AggregationService(evaluationRepository);
    });

    describe('getVersionStats', () => {
        it('deve retornar métricas formatadas e arredondadas quando houver dados', async () => {
            const minDate = new Date('2026-09-01T10:00:00Z');
            const maxDate = new Date('2026-09-07T18:00:00Z');

            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce({
                totalRuns: 50,
                avgCompositeScore: 0.923456,
                avgConfidence: 0.951234,
                avgHallucinationRisk: 0.048765,
                avgToolSuccessRate: 0.982222,
                avgCostUsd: 0.001234567,
                avgLatencyMs: 1450.6,
                totalCostUsd: 0.0617283,
                totalTokens: 12500,
                minDate,
                maxDate,
            });

            const stats = await service.getVersionStats('1.2.0');

            expect(stats.version).toBe('1.2.0');
            expect(stats.totalRuns).toBe(50);
            expect(stats.avgCompositeScore).toBe(0.9235);
            expect(stats.avgConfidence).toBe(0.9512);
            expect(stats.avgHallucinationRisk).toBe(0.0488);
            expect(stats.avgToolSuccessRate).toBe(0.9822);
            expect(stats.avgCostUsd).toBe(0.001235);
            expect(stats.avgLatencyMs).toBe(1451);
            expect(stats.period.from).toEqual(minDate);
            expect(stats.period.to).toEqual(maxDate);
        });

        it('deve retornar estatísticas zeradas se a versão não tiver execuções', async () => {
            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce(null);

            const stats = await service.getVersionStats('non-existent');

            expect(stats.version).toBe('non-existent');
            expect(stats.totalRuns).toBe(0);
            expect(stats.avgCompositeScore).toBe(0);
            expect(stats.period.from).toBeNull();
            expect(stats.period.to).toBeNull();
        });
    });

    describe('compareVersions', () => {
        it('deve comparar duas versões e calcular deltas, regressões e melhorias', async () => {
            // Versão A (1.0.0) - Baseline
            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce({
                totalRuns: 100,
                avgCompositeScore: 0.90,
                avgConfidence: 0.90,
                avgHallucinationRisk: 0.05,
                avgToolSuccessRate: 0.95,
                avgCostUsd: 0.0020,
                avgLatencyMs: 1500,
                totalCostUsd: 0.20,
                totalTokens: 20000,
            });

            // Versão B (1.1.0) - Nova versão com melhoria em compositeScore e regressão em latência
            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce({
                totalRuns: 100,
                avgCompositeScore: 0.99, // +10% -> melhoria
                avgConfidence: 0.92,
                avgHallucinationRisk: 0.02, // queda de 60% no risco -> melhoria
                avgToolSuccessRate: 0.96,
                avgCostUsd: 0.0021,
                avgLatencyMs: 2000, // +33% na latência -> regressão
                totalCostUsd: 0.21,
                totalTokens: 21000,
            });

            const comparison = await service.compareVersions('1.0.0', '1.1.0', 0.10);

            expect(comparison.versionA.version).toBe('1.0.0');
            expect(comparison.versionB.version).toBe('1.1.0');

            // Delta de compositeScore
            expect(comparison.deltas.avgCompositeScore.absolute).toBe(0.09);
            expect(comparison.deltas.avgCompositeScore.percentage).toBe(0.1);

            // Regressões e melhorias detectadas
            expect(comparison.regressions).toContain('avgLatencyMs');
            expect(comparison.improvements).toContain('avgCompositeScore');
            expect(comparison.improvements).toContain('avgHallucinationRisk');
        });
    });

    describe('detectRegression', () => {
        it('deve emitir relatório de regressão quando houver queda > threshold em métricas de qualidade', async () => {
            // v1.0.0 (anterior)
            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce({
                totalRuns: 50,
                avgCompositeScore: 0.90,
                avgConfidence: 0.90,
                avgHallucinationRisk: 0.05,
                avgToolSuccessRate: 1.0,
                avgCostUsd: 0.001,
                avgLatencyMs: 1000,
                totalCostUsd: 0.05,
                totalTokens: 5000,
            });

            // v2.0.0 (atual) com queda drástica no compositeScore e aumento no risco de alucinação
            vi.mocked(evaluationRepository.aggregateByVersion).mockResolvedValueOnce({
                totalRuns: 50,
                avgCompositeScore: 0.70, // queda de 22% (> 10%)
                avgConfidence: 0.85,
                avgHallucinationRisk: 0.15, // aumento de 200% (> 10%)
                avgToolSuccessRate: 0.98,
                avgCostUsd: 0.001,
                avgLatencyMs: 1050,
                totalCostUsd: 0.05,
                totalTokens: 5000,
            });

            const report = await service.detectRegression('2.0.0', '1.0.0', 0.10);

            expect(report.hasRegression).toBe(true);
            expect(report.currentVersion).toBe('2.0.0');
            expect(report.previousVersion).toBe('1.0.0');
            expect(report.regressions.length).toBeGreaterThanOrEqual(2);

            const compositeReg = report.regressions.find(r => r.metric === 'avgCompositeScore');
            expect(compositeReg).toBeDefined();
            expect(compositeReg?.type).toBe('drop_in_quality');

            const hallucinationReg = report.regressions.find(r => r.metric === 'avgHallucinationRisk');
            expect(hallucinationReg).toBeDefined();
            expect(hallucinationReg?.type).toBe('increase_in_risk_or_cost');
        });

        it('deve retornar hasRegression: false quando a versão for estável ou superior', async () => {
            vi.mocked(evaluationRepository.aggregateByVersion)
                .mockResolvedValueOnce({
                    totalRuns: 30,
                    avgCompositeScore: 0.88,
                    avgConfidence: 0.88,
                    avgHallucinationRisk: 0.08,
                    avgToolSuccessRate: 0.95,
                    avgCostUsd: 0.001,
                    avgLatencyMs: 1200,
                    totalCostUsd: 0.03,
                    totalTokens: 3000,
                })
                .mockResolvedValueOnce({
                    totalRuns: 30,
                    avgCompositeScore: 0.92,
                    avgConfidence: 0.91,
                    avgHallucinationRisk: 0.05,
                    avgToolSuccessRate: 0.98,
                    avgCostUsd: 0.001,
                    avgLatencyMs: 1100,
                    totalCostUsd: 0.03,
                    totalTokens: 3000,
                });

            const report = await service.detectRegression('2.1.0', '2.0.0');

            expect(report.hasRegression).toBe(false);
            expect(report.regressions).toHaveLength(0);
        });
    });

    describe('getTenantSummary', () => {
        it('deve retornar o resumo de avaliações do tenant para a janela de tempo', async () => {
            const from = new Date('2026-09-01T00:00:00Z');
            const to = new Date('2026-09-07T23:59:59Z');

            vi.mocked(evaluationRepository.aggregateByTenant).mockResolvedValueOnce({
                totalRuns: 80,
                avgCompositeScore: 0.8956,
                avgConfidence: 0.921,
                avgHallucinationRisk: 0.062,
                avgToolSuccessRate: 0.975,
                avgCostUsd: 0.0015555,
                avgLatencyMs: 1320.4,
                totalCostUsd: 0.12444,
                totalTokens: 25000,
            });

            const summary = await service.getTenantSummary('tenant-corp', from, to);

            expect(summary.tenantId).toBe('tenant-corp');
            expect(summary.from).toEqual(from);
            expect(summary.to).toEqual(to);
            expect(summary.totalRuns).toBe(80);
            expect(summary.avgCompositeScore).toBe(0.8956);
            expect(summary.avgLatencyMs).toBe(1320);
            expect(summary.totalTokens).toBe(25000);
        });

        it('deve retornar resumo zerado quando não houver avaliações para o tenant', async () => {
            vi.mocked(evaluationRepository.aggregateByTenant).mockResolvedValueOnce(null);

            const from = new Date('2026-09-01T00:00:00Z');
            const to = new Date('2026-09-07T23:59:59Z');

            const summary = await service.getTenantSummary('tenant-zero', from, to);

            expect(summary.totalRuns).toBe(0);
            expect(summary.avgCompositeScore).toBe(0);
            expect(summary.totalCostUsd).toBe(0);
        });
    });
});
