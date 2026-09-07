import type { IEvaluationRepository } from "../domain/ports/IEvaluationRepository.js";
import type {
    VersionStats,
    ComparisonResult,
    MetricDelta,
    RegressionReport,
    RegressionDetail,
    TenantEvalSummary,
} from "./types.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'AggregationService' });

export class AggregationService {
    constructor(private readonly evaluationRepository: IEvaluationRepository) {}

    /**
     * Obtém as estatísticas analíticas consolidadas de uma versão específica do agente.
     */
    async getVersionStats(version: string): Promise<VersionStats> {
        const raw = await this.evaluationRepository.aggregateByVersion(version);
        if (!raw || raw.totalRuns === 0) {
            return {
                version,
                totalRuns: 0,
                avgCompositeScore: 0,
                avgConfidence: 0,
                avgHallucinationRisk: 0,
                avgToolSuccessRate: 0,
                avgCostUsd: 0,
                avgLatencyMs: 0,
                totalCostUsd: 0,
                totalTokens: 0,
                period: { from: null, to: null },
            };
        }

        return {
            version,
            totalRuns: raw.totalRuns,
            avgCompositeScore: Number(raw.avgCompositeScore.toFixed(4)),
            avgConfidence: Number(raw.avgConfidence.toFixed(4)),
            avgHallucinationRisk: Number(raw.avgHallucinationRisk.toFixed(4)),
            avgToolSuccessRate: Number(raw.avgToolSuccessRate.toFixed(4)),
            avgCostUsd: Number(raw.avgCostUsd.toFixed(6)),
            avgLatencyMs: Math.round(raw.avgLatencyMs),
            totalCostUsd: Number(raw.totalCostUsd.toFixed(6)),
            totalTokens: raw.totalTokens,
            period: {
                from: raw.minDate ?? null,
                to: raw.maxDate ?? null,
            },
        };
    }

    /**
     * Compara duas versões do agente (versão anterior vs nova versão).
     * @param versionA Versão de referência / anterior
     * @param versionB Versão candidata / atual
     * @param threshold Limiar de variação relativa (padrão 0.10 = 10%)
     */
    async compareVersions(
        versionA: string,
        versionB: string,
        threshold = 0.10
    ): Promise<ComparisonResult> {
        const [statsA, statsB] = await Promise.all([
            this.getVersionStats(versionA),
            this.getVersionStats(versionB),
        ]);

        const metricsToCompare: Array<{ key: keyof VersionStats; higherIsBetter: boolean }> = [
            { key: 'avgCompositeScore', higherIsBetter: true },
            { key: 'avgConfidence', higherIsBetter: true },
            { key: 'avgToolSuccessRate', higherIsBetter: true },
            { key: 'avgHallucinationRisk', higherIsBetter: false },
            { key: 'avgCostUsd', higherIsBetter: false },
            { key: 'avgLatencyMs', higherIsBetter: false },
        ];

        const deltas: Record<string, MetricDelta> = {};
        const regressions: string[] = [];
        const improvements: string[] = [];

        for (const { key, higherIsBetter } of metricsToCompare) {
            const valA = Number(statsA[key]) || 0;
            const valB = Number(statsB[key]) || 0;
            const absolute = Number((valB - valA).toFixed(6));
            const percentage = valA > 0 ? Number(((valB - valA) / valA).toFixed(4)) : 0;

            deltas[key as string] = {
                previous: valA,
                current: valB,
                absolute,
                percentage,
            };

            if (higherIsBetter) {
                // Para métricas de qualidade: queda além do threshold é regressão
                if (percentage <= -threshold) {
                    regressions.push(key as string);
                } else if (percentage >= threshold) {
                    improvements.push(key as string);
                }
            } else {
                // Para métricas de custo, latência e risco: aumento além do threshold é regressão
                if (percentage >= threshold) {
                    regressions.push(key as string);
                } else if (percentage <= -threshold) {
                    improvements.push(key as string);
                }
            }
        }

        return {
            versionA: statsA,
            versionB: statsB,
            deltas,
            regressions,
            improvements,
        };
    }

    /**
     * Detecta se houve regressão ao comparar a versão atual contra uma versão anterior.
     * Retorna relatório com justificativa e detalhes por métrica.
     */
    async detectRegression(
        currentVersion: string,
        previousVersion: string,
        threshold = 0.10
    ): Promise<RegressionReport> {
        // versionA = previous, versionB = current
        const comparison = await this.compareVersions(previousVersion, currentVersion, threshold);

        const details: RegressionDetail[] = [];

        for (const metric of comparison.regressions) {
            const delta = comparison.deltas[metric];
            const isQualityMetric = ['avgCompositeScore', 'avgConfidence', 'avgToolSuccessRate'].includes(metric);

            details.push({
                metric,
                previous: delta.previous,
                current: delta.current,
                delta: delta.absolute,
                percentage: delta.percentage,
                type: isQualityMetric ? 'drop_in_quality' : 'increase_in_risk_or_cost',
            });
        }

        const hasRegression = details.length > 0;
        if (hasRegression) {
            log.warn(
                { currentVersion, previousVersion, regressionsCount: details.length },
                'Regressão detectada na avaliação da versão do agente.'
            );
        }

        return {
            hasRegression,
            currentVersion,
            previousVersion,
            threshold,
            regressions: details,
        };
    }

    /**
     * Obtém resumo analítico de avaliações de um tenant em uma janela de tempo.
     */
    async getTenantSummary(tenantId: string, from: Date, to: Date): Promise<TenantEvalSummary> {
        const raw = await this.evaluationRepository.aggregateByTenant(tenantId, from, to);
        if (!raw || raw.totalRuns === 0) {
            return {
                tenantId,
                from,
                to,
                totalRuns: 0,
                avgCompositeScore: 0,
                avgConfidence: 0,
                avgHallucinationRisk: 0,
                avgToolSuccessRate: 0,
                totalCostUsd: 0,
                totalTokens: 0,
                avgLatencyMs: 0,
            };
        }

        return {
            tenantId,
            from,
            to,
            totalRuns: raw.totalRuns,
            avgCompositeScore: Number(raw.avgCompositeScore.toFixed(4)),
            avgConfidence: Number(raw.avgConfidence.toFixed(4)),
            avgHallucinationRisk: Number(raw.avgHallucinationRisk.toFixed(4)),
            avgToolSuccessRate: Number(raw.avgToolSuccessRate.toFixed(4)),
            totalCostUsd: Number(raw.totalCostUsd.toFixed(6)),
            totalTokens: raw.totalTokens,
            avgLatencyMs: Math.round(raw.avgLatencyMs),
        };
    }
}
