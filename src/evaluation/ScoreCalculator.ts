import type { PassiveMetrics, SelfEvalScores } from "../domain/EvaluationResult.js";

export interface EvaluationWeights {
    confidence: number;
    hallucinationRisk: number;
    completeness: number;
    toolSelectionQuality: number;
    contextRelevance: number;
    performance: number;
}

export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeights = {
    confidence: 0.20,
    hallucinationRisk: 0.25,
    completeness: 0.20,
    toolSelectionQuality: 0.15,
    contextRelevance: 0.10,
    performance: 0.10,
};

/**
 * Garante que um valor numérico esteja contido no intervalo [min, max].
 */
function clamp(val: number, min = 0, max = 1): number {
    if (isNaN(val)) return 0;
    return Math.max(min, Math.min(max, val));
}

/**
 * Calcula o score de performance (0 a 1) combinando latência e taxa de sucesso de ferramentas.
 */
export function calculatePerformanceScore(passive: PassiveMetrics): number {
    // Latência: pontuação máxima (1.0) até 3s, degradando linearmente até 0.0 aos 30s
    const minLatency = 3000;
    const maxLatency = 30000;
    const duration = Math.max(0, passive.durationMs);

    let latencyScore = 1.0;
    if (duration > minLatency) {
        latencyScore = 1 - (duration - minLatency) / (maxLatency - minLatency);
    }
    latencyScore = clamp(latencyScore);

    // Taxa de sucesso de ferramentas (se nenhuma chamada foi feita, score é 1.0)
    const toolScore = clamp(passive.toolSuccessRate ?? 1.0);

    return clamp((latencyScore * 0.5) + (toolScore * 0.5));
}

/**
 * Calcula o Composite Score ponderado combinando dimensões de auto-avaliação (LLM)
 * e métricas passivas de execução.
 */
export function calculateCompositeScore(
    passive: PassiveMetrics,
    selfEval: SelfEvalScores,
    weights: Partial<EvaluationWeights> = {}
): number {
    const finalWeights: EvaluationWeights = {
        ...DEFAULT_EVALUATION_WEIGHTS,
        ...weights,
    };

    // Dimensões auto-avaliadas (com clamp [0, 1])
    const confidenceScore = clamp(selfEval.confidence);
    // O risco de alucinação é invertido (baixo risco = pontuação alta)
    const groundednessScore = clamp(1 - clamp(selfEval.hallucinationRisk));
    const completenessScore = clamp(selfEval.completeness);
    const toolScore = clamp(selfEval.toolSelectionQuality);
    const contextScore = clamp(selfEval.contextRelevance);

    // Métrica passiva calculada
    const performanceScore = calculatePerformanceScore(passive);

    const rawComposite =
        (confidenceScore * finalWeights.confidence) +
        (groundednessScore * finalWeights.hallucinationRisk) +
        (completenessScore * finalWeights.completeness) +
        (toolScore * finalWeights.toolSelectionQuality) +
        (contextScore * finalWeights.contextRelevance) +
        (performanceScore * finalWeights.performance);

    const totalWeight =
        finalWeights.confidence +
        finalWeights.hallucinationRisk +
        finalWeights.completeness +
        finalWeights.toolSelectionQuality +
        finalWeights.contextRelevance +
        finalWeights.performance;

    const normalized = totalWeight > 0 ? rawComposite / totalWeight : 0;
    return Number(clamp(normalized).toFixed(4));
}
