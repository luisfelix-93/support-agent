import type { AgentRun, AgentRunStatus } from "../AgentRun.js";

export interface FindRunsOptions {
    limit?: number;
    offset?: number;
    status?: AgentRunStatus;
    from?: Date;
    to?: Date;
}

export interface TenantCostSummary {
    tenantId: string;
    totalRuns: number;
    totalCostUsd: number;
    avgCostUsd: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgDurationMs: number;
}

export interface ToolAnalyticsSummary {
    toolName: string;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    successRate: number;
    avgDurationMs: number;
}

export interface LLMAnalyticsSummary {
    provider: string;
    model: string;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCostUsd: number;
    avgLatencyMs: number;
}

export interface IAgentRunRepository {
    save(run: AgentRun): Promise<void>;
    findByRunId(runId: string): Promise<AgentRun | null>;
    findByTenant(tenantId: string, options?: FindRunsOptions): Promise<AgentRun[]>;
    aggregateCostByTenant(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]>;
    aggregateToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]>;
    aggregateLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]>;
}

