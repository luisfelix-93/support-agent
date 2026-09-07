import { describe, it, expect } from 'vitest';
import { LLM_PRICING, calculateCost } from './LLMPricingTable.js';

describe('LLMPricingTable', () => {
    it('deve conter preços para todos os modelos suportados', () => {
        expect(LLM_PRICING['gpt-4o']).toEqual({ input: 2.50, output: 10.00 });
        expect(LLM_PRICING['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.60 });
        expect(LLM_PRICING['gemini-2.0-flash']).toEqual({ input: 0.10, output: 0.40 });
        expect(LLM_PRICING['claude-3-5-sonnet']).toEqual({ input: 3.00, output: 15.00 });
        expect(LLM_PRICING['deepseek-chat']).toEqual({ input: 0.14, output: 0.28 });
    });

    it('deve calcular o custo corretamente para gpt-4o', () => {
        // 1M input ($2.50) + 1M output ($10.00) = $12.50
        const cost = calculateCost('gpt-4o', 1_000_000, 1_000_000);
        expect(cost).toBe(12.5);

        // 1,000 input + 500 output
        // input: 1,000 / 1,000,000 * 2.50 = 0.0025
        // output: 500 / 1,000,000 * 10.00 = 0.005
        // total: 0.0075
        const partialCost = calculateCost('gpt-4o', 1000, 500);
        expect(partialCost).toBe(0.0075);
    });

    it('deve calcular o custo corretamente para gemini-2.0-flash', () => {
        // input: 10,000 / 1,000,000 * 0.10 = 0.001
        // output: 2,000 / 1,000,000 * 0.40 = 0.0008
        // total: 0.0018
        const cost = calculateCost('gemini-2.0-flash', 10000, 2000);
        expect(cost).toBe(0.0018);
    });

    it('deve retornar 0 para modelo desconhecido', () => {
        const cost = calculateCost('non-existent-model', 1000, 500);
        expect(cost).toBe(0);
    });

    it('deve retornar 0 quando tokens forem zero', () => {
        const cost = calculateCost('gpt-4o', 0, 0);
        expect(cost).toBe(0);
    });
});
