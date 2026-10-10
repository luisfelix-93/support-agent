export interface ExecutionPolicyConfig {
    maxIterations: number;
    mcpTimeoutMs: number;
    maxContextTokens: number;
    maxRunTimeMs: number;
    llmTimeoutMs: number;
    maxIdenticalToolCalls: number;
    maxToolOutputChars: number;
    maxToolOutputLines: number;
}

export class ExecutionPolicy {
    public readonly maxIterations: number;
    public readonly mcpTimeoutMs: number;
    public readonly maxContextTokens: number;
    public readonly maxRunTimeMs: number;
    public readonly llmTimeoutMs: number;
    public readonly maxIdenticalToolCalls: number;
    public readonly maxToolOutputChars: number;
    public readonly maxToolOutputLines: number;

    constructor(config?: Partial<ExecutionPolicyConfig>) {
        this.maxIterations = config?.maxIterations ?? (Number(process.env.MAX_TOOL_ITERATIONS) || 12);
        this.mcpTimeoutMs = config?.mcpTimeoutMs ?? (Number(process.env.MCP_TIMEOUT_MS) || 25000);
        this.maxContextTokens = config?.maxContextTokens ?? (Number(process.env.MAX_CONTEXT_TOKENS) || 4096);
        this.maxRunTimeMs = config?.maxRunTimeMs ?? (Number(process.env.MAX_RUN_TIME_MS) || 120000);
        this.llmTimeoutMs = config?.llmTimeoutMs ?? (Number(process.env.LLM_TIMEOUT_MS) || 60000);
        this.maxIdenticalToolCalls = config?.maxIdenticalToolCalls ?? (Number(process.env.MAX_IDENTICAL_TOOL_CALLS) || 2);
        this.maxToolOutputChars = config?.maxToolOutputChars ?? (Number(process.env.MAX_TOOL_OUTPUT_CHARS) || 6000);
        this.maxToolOutputLines = config?.maxToolOutputLines ?? (Number(process.env.MAX_TOOL_OUTPUT_LINES) || 50);
    }

    shouldContinue(iteration: number): boolean {
        return iteration < this.maxIterations;
    }
}

