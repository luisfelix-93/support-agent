import { describe, it, expect } from 'vitest';
import { calculateCompositeScore, calculatePerformanceScore, DEFAULT_EVALUATION_WEIGHTS } from './ScoreCalculator.js';
import type { PassiveMetrics, SelfEvalScores } from '../domain/EvaluationResult.js';

describe('ScoreCalculator', () => {
    const defaultPassive: PassiveMetrics = {
        durationMs: 2000,
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
    };

    const defaultSelfEval: SelfEvalScores = {
        confidence: 0.9,
        hallucinationRisk: 0.1,
        contextRelevance: 0.8,
        completeness: 0.9,
        toolSelectionQuality: 1.0,
    };

    it('deve calcular score perfeito (1.0) para execução ideal', () => {
        const perfectSelfEval: SelfEvalScores = {
            confidence: 1.0,
            hallucinationRisk: 0.0, // Risco zero -> groundedness 1.0
            contextRelevance: 1.0,
            completeness: 1.0,
            toolSelectionQuality: 1.0,
        };

        const perfectPassive: PassiveMetrics = {
            ...defaultPassive,
            durationMs: 1000, // < 3000ms -> latencyScore 1.0
            toolSuccessRate: 1.0,
        };

        const score = calculateCompositeScore(perfectPassive, perfectSelfEval);
        expect(score).toBe(1.0);
    });

    it('deve calcular score nulo (0.0) para pior execução possível', () => {
        const worstSelfEval: SelfEvalScores = {
            confidence: 0.0,
            hallucinationRisk: 1.0, // Risco máximo -> groundedness 0.0
            contextRelevance: 0.0,
            completeness: 0.0,
            toolSelectionQuality: 0.0,
        };

        const worstPassive: PassiveMetrics = {
            ...defaultPassive,
            durationMs: 35000, // > 30000ms -> latencyScore 0.0
            toolSuccessRate: 0.0, // toolScore 0.0 -> performance 0.0
        };

        const score = calculateCompositeScore(worstPassive, worstSelfEval);
        expect(score).toBe(0.0);
    });

    it('deve calcular a média ponderada exata com pesos padrão', () => {
        const selfEval: SelfEvalScores = {
            confidence: 0.8,         // * 0.20 = 0.16
            hallucinationRisk: 0.2,  // (1 - 0.2) = 0.8 * 0.25 = 0.20
            completeness: 0.9,       // * 0.20 = 0.18
            toolSelectionQuality: 1.0, // * 0.15 = 0.15
            contextRelevance: 0.7,   // * 0.10 = 0.07
        };

        const passive: PassiveMetrics = {
            ...defaultPassive,
            durationMs: 2500, // latencyScore = 1.0
            toolSuccessRate: 1.0, // toolScore = 1.0 -> performance = 1.0 * 0.10 = 0.10
        };

        // Total esperado: 0.16 + 0.20 + 0.18 + 0.15 + 0.07 + 0.10 = 0.86
        const score = calculateCompositeScore(passive, selfEval);
        expect(score).toBe(0.86);
    });

    it('deve permitir sobrescrever pesos customizados', () => {
        const selfEval: SelfEvalScores = {
            confidence: 1.0,
            hallucinationRisk: 0.0,
            completeness: 0.5,
            toolSelectionQuality: 0.5,
            contextRelevance: 0.5,
        };

        // Dando peso 1.0 apenas para confidence
        const customScore = calculateCompositeScore(defaultPassive, selfEval, {
            confidence: 1.0,
            hallucinationRisk: 0,
            completeness: 0,
            toolSelectionQuality: 0,
            contextRelevance: 0,
            performance: 0,
        });

        expect(customScore).toBe(1.0);
    });

    it('deve aplicar clamp em valores fora do intervalo [0, 1] e NaN', () => {
        const anomalousSelfEval: SelfEvalScores = {
            confidence: 5.0, // deve ser clampado em 1.0
            hallucinationRisk: -2.0, // deve ser clampado em 0.0 -> groundedness 1.0
            completeness: NaN as any, // deve ser clampado em 0.0
            toolSelectionQuality: 1.5,
            contextRelevance: -0.5,
        };

        const score = calculateCompositeScore(defaultPassive, anomalousSelfEval);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    describe('calculatePerformanceScore', () => {
        it('deve pontuar 1.0 quando latência for baixa e ferramentas bem sucedidas', () => {
            const perf = calculatePerformanceScore({
                ...defaultPassive,
                durationMs: 1500,
                toolSuccessRate: 1.0,
            });
            expect(perf).toBe(1.0);
        });

        it('deve pontuar 1.0 quando não houver chamadas de ferramenta (taxa default 1.0)', () => {
            const perf = calculatePerformanceScore({
                ...defaultPassive,
                toolCallsTotal: 0,
                toolSuccessRate: 1.0,
                durationMs: 2000,
            });
            expect(perf).toBe(1.0);
        });

        it('deve degradar a pontuação linearmente conforme latência sobe', () => {
            // Latência a 16500ms (metade entre 3000ms e 30000ms -> latencyScore 0.5)
            const perf = calculatePerformanceScore({
                ...defaultPassive,
                durationMs: 16500,
                toolSuccessRate: 1.0,
            });
            // latency 0.5 * 0.5 + tool 1.0 * 0.5 = 0.25 + 0.5 = 0.75
            expect(perf).toBeCloseTo(0.75, 2);
        });
    });
});
