export interface SelfEvalScores {
    /** Grau de certeza e assertividade da resposta sem hesitações indevidas (0.0 a 1.0) */
    confidence: number;
    /** Risco de a resposta conter dados inventados ou não fundamentados (0.0 = sem alucinação, 1.0 = certeza de alucinação) */
    hallucinationRisk: number;
    /** Qualidade do aproveitamento de memórias injetadas e contexto fornecido (0.0 a 1.0) */
    contextRelevance: number;
    /** Grau em que a resposta resolve a dúvida ou problema do usuário (0.0 a 1.0) */
    completeness: number;
    /** Qualidade, necessidade e correção na seleção e parametrização de ferramentas (0.0 a 1.0) */
    toolSelectionQuality: number;
    /** Raciocínio conciso justificando os scores atribuídos */
    reasoning?: string;
}

export interface PassiveMetrics {
    durationMs: number;
    iterations: number;
    toolCallsTotal: number;
    toolCallsFailed: number;
    toolSuccessRate: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    costUsd: number;
    memoriesInjected: number;
    contextUtilization: number;
}

export class EvaluationResult {
    constructor(
        public readonly runId: string,
        public readonly tenantId: string,
        public readonly workspaceId: string,
        public readonly agentVersion: string,
        public readonly passive: PassiveMetrics,
        public readonly selfEval: SelfEvalScores,
        public readonly compositeScore: number,
        public readonly evaluatedAt: Date = new Date()
    ) {}
}
