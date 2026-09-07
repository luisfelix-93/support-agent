import type { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import { EvaluationResult, type PassiveMetrics, type SelfEvalScores } from "../domain/EvaluationResult.js";
import type { IEvaluationRepository, FindEvaluationsOptions } from "../domain/ports/IEvaluationRepository.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'EvaluationRepository' });

export interface EvaluationResultDocument {
    _id?: any;
    runId: string;
    tenantId: string;
    workspaceId: string;
    agentVersion: string;
    passive: PassiveMetrics;
    selfEval: SelfEvalScores;
    compositeScore: number;
    evaluatedAt: Date;
}

export class EvaluationRepository implements IEvaluationRepository {
    private get collection(): Collection<EvaluationResultDocument> {
        return MongoConnection.getDb().collection<EvaluationResultDocument>('evaluation_results');
    }

    async createIndexes(): Promise<void> {
        await this.collection.createIndex({ runId: 1 }, { unique: true });
        await this.collection.createIndex({ tenantId: 1, evaluatedAt: -1 });
        await this.collection.createIndex({ agentVersion: 1 });
    }

    async save(result: EvaluationResult): Promise<void> {
        const doc = this.toDocument(result);
        await this.collection.updateOne(
            { runId: result.runId },
            { $set: doc },
            { upsert: true }
        );
        log.debug({ runId: result.runId, tenantId: result.tenantId, compositeScore: result.compositeScore }, 'EvaluationResult salvo com sucesso.');
    }

    async findByRunId(runId: string): Promise<EvaluationResult | null> {
        const doc = await this.collection.findOne({ runId });
        if (!doc) return null;
        return this.toDomain(doc);
    }

    async findByTenant(tenantId: string, options?: FindEvaluationsOptions): Promise<EvaluationResult[]> {
        const query: Record<string, any> = { tenantId };

        if (options?.agentVersion) {
            query.agentVersion = options.agentVersion;
        }

        if (options?.from || options?.to) {
            query.evaluatedAt = {};
            if (options.from) query.evaluatedAt.$gte = options.from;
            if (options.to) query.evaluatedAt.$lte = options.to;
        }

        let cursor = this.collection.find(query).sort({ evaluatedAt: -1 });

        if (options?.skip) {
            cursor = cursor.skip(options.skip);
        }

        if (options?.limit) {
            cursor = cursor.limit(options.limit);
        }

        const docs = await cursor.toArray();
        return docs.map(doc => this.toDomain(doc));
    }

    private toDocument(domain: EvaluationResult): Omit<EvaluationResultDocument, '_id'> {
        return {
            runId: domain.runId,
            tenantId: domain.tenantId,
            workspaceId: domain.workspaceId,
            agentVersion: domain.agentVersion,
            passive: domain.passive,
            selfEval: domain.selfEval,
            compositeScore: domain.compositeScore,
            evaluatedAt: domain.evaluatedAt,
        };
    }

    private toDomain(doc: EvaluationResultDocument): EvaluationResult {
        return new EvaluationResult(
            doc.runId,
            doc.tenantId,
            doc.workspaceId,
            doc.agentVersion,
            doc.passive,
            doc.selfEval,
            doc.compositeScore,
            doc.evaluatedAt
        );
    }
}
