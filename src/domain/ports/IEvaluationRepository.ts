import type { EvaluationResult } from "../EvaluationResult.js";
import type { AggregatedEvaluation } from "../../evaluation/types.js";

export interface FindEvaluationsOptions {
    limit?: number;
    skip?: number;
    from?: Date;
    to?: Date;
    agentVersion?: string;
}

export interface IEvaluationRepository {
    createIndexes(): Promise<void>;
    save(result: EvaluationResult): Promise<void>;
    findByRunId(runId: string): Promise<EvaluationResult | null>;
    findByTenant(tenantId: string, options?: FindEvaluationsOptions): Promise<EvaluationResult[]>;
    aggregateByVersion(version: string): Promise<AggregatedEvaluation | null>;
    aggregateByTenant(tenantId: string, from: Date, to: Date): Promise<AggregatedEvaluation | null>;
}
