// Preço por 1 milhão (1,000,000) de tokens (input / output) em USD
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
    'gpt-4o':            { input: 2.50,  output: 10.00 },
    'gpt-4o-mini':       { input: 0.15,  output: 0.60  },
    'gemini-2.0-flash':  { input: 0.10,  output: 0.40  },
    'claude-3-5-sonnet': { input: 3.00,  output: 15.00 },
    'deepseek-chat':     { input: 0.14,  output: 0.28  },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = LLM_PRICING[model];
    if (!pricing) {
        return 0;
    }
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
