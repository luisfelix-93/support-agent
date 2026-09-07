export interface AggregatedEvaluation {
    id?: string;
    totalRuns: number;
    avgCompositeScore: number;
    avgConfidence: number;
    avgHallucinationRisk: number;
    avgToolSuccessRate: number;
    avgCostUsd: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    totalTokens: number;
    minDate?: Date;
    maxDate?: Date;
}

export interface VersionStats {
    version: string;
    totalRuns: number;
    avgCompositeScore: number;
    avgConfidence: number;
    avgHallucinationRisk: number;
    avgToolSuccessRate: number;
    avgCostUsd: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    totalTokens: number;
    period: {
        from: Date | null;
        to: Date | null;
    };
}

export interface MetricDelta {
    previous: number;
    current: number;
    absolute: number;
    percentage: number;
}

export interface ComparisonResult {
    versionA: VersionStats;
    versionB: VersionStats;
    deltas: Record<string, MetricDelta>;
    regressions: string[];   // Métricas que pioraram além do threshold
    improvements: string[];  // Métricas que melhoraram além do threshold
}

export interface RegressionDetail {
    metric: string;
    previous: number;
    current: number;
    delta: number;
    percentage: number;
    type: 'drop_in_quality' | 'increase_in_risk_or_cost';
}

export interface RegressionReport {
    hasRegression: boolean;
    currentVersion: string;
    previousVersion: string;
    threshold: number;
    regressions: RegressionDetail[];
}

export interface TenantEvalSummary {
    tenantId: string;
    from: Date;
    to: Date;
    totalRuns: number;
    avgCompositeScore: number;
    avgConfidence: number;
    avgHallucinationRisk: number;
    avgToolSuccessRate: number;
    totalCostUsd: number;
    totalTokens: number;
    avgLatencyMs: number;
}
