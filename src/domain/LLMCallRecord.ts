export interface LLMCallRecord {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    latencyMs: number;
    resultType: 'text' | 'tool_call';
    costUsd?: number;
}
