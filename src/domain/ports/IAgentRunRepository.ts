import type { AgentRun } from "../AgentRun.js";

export interface FindRunsOptions {
    limit?: number;
    offset?: number;
}

export interface IAgentRunRepository {
    save(run: AgentRun): Promise<void>;
    findByRunId(runId: string): Promise<AgentRun | null>;
    findByTenant(tenantId: string, options?: FindRunsOptions): Promise<AgentRun[]>;
}
