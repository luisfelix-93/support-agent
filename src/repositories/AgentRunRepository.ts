import type { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { AgentRun, type AgentRunStatus, type ToolCallRecord } from "../domain/AgentRun.js";
import type {
    IAgentRunRepository,
    FindRunsOptions,
    TenantCostSummary,
    ToolAnalyticsSummary,
    LLMAnalyticsSummary
} from "../domain/ports/IAgentRunRepository.js";
import type { LLMCallRecord } from "../domain/LLMCallRecord.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'AgentRunRepository' });

export interface AgentRunDocument {
    _id?: any;
    runId: string;
    tenantId: string;
    workspaceId: string;
    threadId: string;
    status: AgentRunStatus;
    iterations: number;
    toolCalls: ToolCallRecord[];
    llmCalls: LLMCallRecord[];
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    costUsd: number;
    memoriesInjected: number;
    contextUtilization: number;
    agentVersion: string;
    finalResponse?: string;
    userMessage?: string;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
}

export class AgentRunRepository implements IAgentRunRepository {
    private get collection(): Collection<AgentRunDocument> {
        return MongoConnection.getDb().collection<AgentRunDocument>('agent_runs');
    }

    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ runId: 1 }, { unique: true });
        await this.collection.createIndex({ tenantId: 1, startedAt: -1 });
        await this.collection.createIndex({ tenantId: 1, status: 1, startedAt: -1 });
    }

    async save(run: AgentRun): Promise<void> {
        const doc = this.toDocument(run);
        await this.collection.updateOne(
            { runId: run.id },
            { $set: doc },
            { upsert: true }
        );
        log.debug({ runId: run.id, tenantId: run.tenantId }, 'AgentRun salvo com sucesso.');
    }

    async findByRunId(runId: string): Promise<AgentRun | null> {
        const doc = await this.collection.findOne({ runId });
        if (!doc) return null;
        return this.toDomain(doc);
    }

    async findByTenant(tenantId: string, options?: FindRunsOptions): Promise<AgentRun[]> {
        const limit = options?.limit ?? 50;
        const skip = options?.offset ?? 0;

        const query: Record<string, any> = { tenantId };

        if (options?.status) {
            query.status = options.status;
        }

        if (options?.from || options?.to) {
            query.startedAt = {};
            if (options.from) query.startedAt.$gte = options.from;
            if (options.to) query.startedAt.$lte = options.to;
        }

        const docs = await this.collection
            .find(query)
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        return docs.map(doc => this.toDomain(doc));
    }

    async aggregateCostByTenant(tenantId?: string, from?: Date, to?: Date): Promise<TenantCostSummary[]> {
        const match: Record<string, any> = {};
        if (tenantId) match.tenantId = tenantId;
        if (from || to) {
            match.startedAt = {};
            if (from) match.startedAt.$gte = from;
            if (to) match.startedAt.$lte = to;
        }

        const pipeline: any[] = [
            ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
            {
                $project: {
                    tenantId: 1,
                    costUsd: { $ifNull: ["$costUsd", 0] },
                    totalTokens: { $ifNull: ["$totalTokens", 0] },
                    totalInputTokens: { $ifNull: ["$totalInputTokens", 0] },
                    totalOutputTokens: { $ifNull: ["$totalOutputTokens", 0] },
                    durationMs: {
                        $cond: [
                            { $and: ["$completedAt", "$startedAt"] },
                            { $subtract: ["$completedAt", "$startedAt"] },
                            0
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: "$tenantId",
                    totalRuns: { $sum: 1 },
                    totalCostUsd: { $sum: "$costUsd" },
                    avgCostUsd: { $avg: "$costUsd" },
                    totalTokens: { $sum: "$totalTokens" },
                    totalInputTokens: { $sum: "$totalInputTokens" },
                    totalOutputTokens: { $sum: "$totalOutputTokens" },
                    avgDurationMs: { $avg: "$durationMs" }
                }
            },
            { $sort: { totalCostUsd: -1 } }
        ];

        const results = await this.collection.aggregate(pipeline).toArray();
        return results.map(doc => ({
            tenantId: doc._id,
            totalRuns: doc.totalRuns ?? 0,
            totalCostUsd: Math.round((doc.totalCostUsd ?? 0) * 1_000_000) / 1_000_000,
            avgCostUsd: Math.round((doc.avgCostUsd ?? 0) * 1_000_000) / 1_000_000,
            totalTokens: doc.totalTokens ?? 0,
            totalInputTokens: doc.totalInputTokens ?? 0,
            totalOutputTokens: doc.totalOutputTokens ?? 0,
            avgDurationMs: Math.round(doc.avgDurationMs ?? 0)
        }));
    }

    async aggregateToolAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<ToolAnalyticsSummary[]> {
        const match: Record<string, any> = {};
        if (tenantId) match.tenantId = tenantId;
        if (from || to) {
            match.startedAt = {};
            if (from) match.startedAt.$gte = from;
            if (to) match.startedAt.$lte = to;
        }

        const pipeline: any[] = [
            ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
            { $unwind: "$toolCalls" },
            {
                $group: {
                    _id: "$toolCalls.toolName",
                    totalCalls: { $sum: 1 },
                    failedCalls: {
                        $sum: {
                            $cond: [
                                {
                                    $or: [
                                        { $ne: [{ $ifNull: ["$toolCalls.error", null] }, null] },
                                        { $eq: [{ $type: "$toolCalls.error" }, "string"] }
                                    ]
                                },
                                {
                                    $cond: [
                                        { $gt: [{ $strLenCP: { $ifNull: ["$toolCalls.error", ""] } }, 0] },
                                        1,
                                        0
                                    ]
                                },
                                0
                            ]
                        }
                    },
                    avgDurationMs: { $avg: { $ifNull: ["$toolCalls.durationMs", 0] } }
                }
            },
            { $sort: { totalCalls: -1 } }
        ];

        const results = await this.collection.aggregate(pipeline).toArray();
        return results.map(doc => {
            const totalCalls = doc.totalCalls ?? 0;
            const failedCalls = doc.failedCalls ?? 0;
            const successfulCalls = Math.max(0, totalCalls - failedCalls);
            const successRate = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 1000) / 1000 : 0;
            return {
                toolName: doc._id,
                totalCalls,
                successfulCalls,
                failedCalls,
                successRate,
                avgDurationMs: Math.round(doc.avgDurationMs ?? 0)
            };
        });
    }

    async aggregateLLMAnalytics(tenantId?: string, from?: Date, to?: Date): Promise<LLMAnalyticsSummary[]> {
        const match: Record<string, any> = {};
        if (tenantId) match.tenantId = tenantId;
        if (from || to) {
            match.startedAt = {};
            if (from) match.startedAt.$gte = from;
            if (to) match.startedAt.$lte = to;
        }

        const pipeline: any[] = [
            ...(Object.keys(match).length > 0 ? [{ $match: match }] : []),
            { $unwind: "$llmCalls" },
            {
                $group: {
                    _id: {
                        provider: "$llmCalls.provider",
                        model: "$llmCalls.model"
                    },
                    totalCalls: { $sum: 1 },
                    totalInputTokens: { $sum: { $ifNull: ["$llmCalls.inputTokens", 0] } },
                    totalOutputTokens: { $sum: { $ifNull: ["$llmCalls.outputTokens", 0] } },
                    totalTokens: { $sum: { $ifNull: ["$llmCalls.totalTokens", 0] } },
                    totalCostUsd: { $sum: { $ifNull: ["$llmCalls.costUsd", 0] } },
                    avgLatencyMs: { $avg: { $ifNull: ["$llmCalls.latencyMs", 0] } }
                }
            },
            { $sort: { totalCostUsd: -1 } }
        ];

        const results = await this.collection.aggregate(pipeline).toArray();
        return results.map(doc => ({
            provider: doc._id.provider,
            model: doc._id.model,
            totalCalls: doc.totalCalls ?? 0,
            totalInputTokens: doc.totalInputTokens ?? 0,
            totalOutputTokens: doc.totalOutputTokens ?? 0,
            totalTokens: doc.totalTokens ?? 0,
            totalCostUsd: Math.round((doc.totalCostUsd ?? 0) * 1_000_000) / 1_000_000,
            avgLatencyMs: Math.round(doc.avgLatencyMs ?? 0)
        }));
    }


    private toDocument(run: AgentRun): AgentRunDocument {
        return {
            runId: run.id,
            tenantId: run.tenantId,
            workspaceId: run.workspaceId,
            threadId: run.threadId,
            status: run.status,
            iterations: run.iterations,
            toolCalls: run.toolCalls,
            llmCalls: run.llmCalls,
            totalInputTokens: run.totalInputTokens,
            totalOutputTokens: run.totalOutputTokens,
            totalTokens: run.totalTokens,
            costUsd: run.costUsd,
            memoriesInjected: run.memoriesInjected,
            contextUtilization: run.contextUtilization,
            agentVersion: run.agentVersion,
            finalResponse: run.finalResponse,
            userMessage: run.userMessage,
            startedAt: run.startedAt,
            completedAt: run.completedAt,
            error: run.error,
        };
    }

    private toDomain(doc: AgentRunDocument): AgentRun {
        const run = new AgentRun(
            doc.runId,
            doc.tenantId,
            doc.workspaceId,
            doc.threadId,
            doc.status,
            doc.iterations,
            doc.toolCalls ?? [],
            doc.startedAt ?? new Date(),
            doc.completedAt,
            doc.error
        );
        run.llmCalls = doc.llmCalls ?? [];
        run.totalInputTokens = doc.totalInputTokens ?? 0;
        run.totalOutputTokens = doc.totalOutputTokens ?? 0;
        run.totalTokens = doc.totalTokens ?? 0;
        run.costUsd = doc.costUsd ?? 0;
        run.memoriesInjected = doc.memoriesInjected ?? 0;
        run.contextUtilization = doc.contextUtilization ?? 0;
        run.agentVersion = doc.agentVersion ?? '1.0.0';
        run.finalResponse = doc.finalResponse;
        run.userMessage = doc.userMessage;
        return run;
    }
}
