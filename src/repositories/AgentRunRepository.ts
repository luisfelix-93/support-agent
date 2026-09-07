import type { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { AgentRun, type AgentRunStatus, type ToolCallRecord } from "../domain/AgentRun.js";
import type { IAgentRunRepository, FindRunsOptions } from "../domain/ports/IAgentRunRepository.js";
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
        const docs = await this.collection
            .find({ tenantId })
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();
        return docs.map(doc => this.toDomain(doc));
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
