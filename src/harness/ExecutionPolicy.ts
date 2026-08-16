export interface ExecutionPolicyConfig {
    maxIterations: number;
    mcpTimeoutMs: number;
    maxContextTokens: number;
}

export class ExecutionPolicy {
    public readonly maxIterations: number;
    public readonly mcpTimeoutMs: number;
    public readonly maxContextTokens: number;

    constructor(config?: Partial<ExecutionPolicyConfig>) {
        this.maxIterations = config?.maxIterations ?? (Number(process.env.MAX_TOOL_ITERATIONS) || 5);
        this.mcpTimeoutMs = config?.mcpTimeoutMs ?? (Number(process.env.MCP_TIMEOUT_MS) || 25000);
        this.maxContextTokens = config?.maxContextTokens ?? (Number(process.env.MAX_CONTEXT_TOKENS) || 4096);
    }

    shouldContinue(iteration: number): boolean {
        return iteration < this.maxIterations;
    }
}
