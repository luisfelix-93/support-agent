import type { LLMCallRecord } from "./LLMCallRecord.js";

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'max_iterations';

export interface ToolCallRecord {
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
}

export class AgentRun {
    public llmCalls: LLMCallRecord[] = [];
    public totalInputTokens: number = 0;
    public totalOutputTokens: number = 0;
    public totalTokens: number = 0;
    public costUsd: number = 0;
    public memoriesInjected: number = 0;
    public contextUtilization: number = 0;
    public agentVersion: string = process.env.AGENT_VERSION || '1.0.0';
    public finalResponse?: string;
    public userMessage?: string;
    public playbookIds?: string[];

    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly workspaceId: string,
        public readonly threadId: string,
        public status: AgentRunStatus = 'running',
        public iterations: number = 0,
        public toolCalls: ToolCallRecord[] = [],
        public readonly startedAt: Date = new Date(),
        public completedAt?: Date,
        public error?: string
    ) {}

    finish(status: AgentRunStatus, error?: string): void {
        this.status = status;
        this.completedAt = new Date();
        if (error) {
            this.error = error;
        }
        this.computeTotals();
    }

    recordToolCall(toolCall: ToolCallRecord): void {
        this.toolCalls.push(toolCall);
    }

    recordLLMCall(record: LLMCallRecord): void {
        this.llmCalls.push(record);
        this.computeTotals();
    }

    computeTotals(): void {
        let inputTokens = 0;
        let outputTokens = 0;
        let totalTokens = 0;
        let totalCost = 0;

        for (const call of this.llmCalls) {
            inputTokens += call.inputTokens || 0;
            outputTokens += call.outputTokens || 0;
            totalTokens += call.totalTokens || 0;
            totalCost += call.costUsd || 0;
        }

        this.totalInputTokens = inputTokens;
        this.totalOutputTokens = outputTokens;
        this.totalTokens = totalTokens;
        this.costUsd = Math.round(totalCost * 1_000_000) / 1_000_000;
    }
}

