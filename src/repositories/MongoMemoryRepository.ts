import type { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import type {
    Memory,
    MemorySearchInput,
    HybridMemorySearchInput,
    HybridSearchResult,
    MemoryType,
    MemoryStatus
} from "../domain/Memory.js";
import type { IMemoryRepository } from "../domain/ports/IMemoryRepository.js";
import { logger } from "../config/logger.js";
import {
    agentMemorySearchDurationSeconds,
    agentMemoryPromotedTotal
} from "../infrastructure/metrics/AgentMetrics.js";

const log = logger.child({ module: 'MongoMemoryRepository' });

export interface MemoryDocument {
    _id: string;
    tenantId: string;
    workspaceId: string;
    threadId?: string;
    type: MemoryType;
    status: MemoryStatus;
    content: string;
    importance: number;
    confidenceScore?: number;
    tags?: string[];
    ttlSeconds?: number;
    expiresAt?: Date;
    validatedBy?: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

export class MongoMemoryRepository implements IMemoryRepository {
    private get collection(): Collection<MemoryDocument> {
        return MongoConnection.getDb().collection<MemoryDocument>('memories');
    }

    async save(memory: Memory): Promise<void> {
        const doc = this.toDocument(memory);
        await this.collection.updateOne(
            { _id: doc._id, tenantId: memory.tenantId },
            { $set: doc },
            { upsert: true }
        );
        agentMemoryPromotedTotal.inc({ tenantId: memory.tenantId, type: memory.type });
        log.debug({ memoryId: memory.id, tenantId: memory.tenantId }, 'Memória salva com sucesso.');
    }

    async saveBatch(memories: Memory[]): Promise<void> {
        if (memories.length === 0) return;

        const operations = memories.map(memory => {
            const doc = this.toDocument(memory);
            return {
                updateOne: {
                    filter: { _id: doc._id, tenantId: memory.tenantId },
                    update: { $set: doc },
                    upsert: true,
                }
            };
        });

        await this.collection.bulkWrite(operations);
        for (const memory of memories) {
            agentMemoryPromotedTotal.inc({ tenantId: memory.tenantId, type: memory.type });
        }
        log.debug({ count: memories.length }, 'Lote de memórias salvo com sucesso.');
    }

    async searchRelevant(input: MemorySearchInput): Promise<Memory[]> {
        const startTime = Date.now();
        const searchType = input.vector && input.vector.length > 0 ? 'vector' : 'text';

        try {
            const limit = input.limit ?? 5;
            const threshold = input.threshold ?? 0.65;

            // 1. Busca Semântica Vetorial (se vetor fornecido)
            if (input.vector && input.vector.length > 0) {
                const filter: any = {
                    tenantId: input.tenantId,
                    workspaceId: input.workspaceId,
                    embedding: { $exists: true, $ne: [] },
                };

                if (input.type) {
                    filter.type = input.type;
                }

                const docs = await this.collection.find(filter).toArray();

                // Calcula similaridade por cosseno em memória
                const scoredDocs = docs
                    .map(doc => {
                        const similarity = this.calculateCosineSimilarity(input.vector!, doc.embedding || []);
                        return { doc, similarity };
                    })
                    .filter(item => item.similarity >= threshold)
                    .sort((a, b) => b.similarity - a.similarity)
                    .slice(0, limit);

                return scoredDocs.map(item => this.toDomain(item.doc));
            }

            // 2. Busca Textual com Regex / Filtro Padrão
            const filter: any = {
                tenantId: input.tenantId,
                workspaceId: input.workspaceId,
            };

            if (input.type) {
                filter.type = input.type;
            }

            if (input.query && input.query.trim()) {
                const escapedQuery = input.query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                filter.content = { $regex: escapedQuery, $options: 'i' };
            }

            const docs = await this.collection
                .find(filter)
                .sort({ importance: -1, createdAt: -1 })
                .limit(limit)
                .toArray();

            return docs.map(doc => this.toDomain(doc));
        } finally {
            const durationSeconds = (Date.now() - startTime) / 1000;
            agentMemorySearchDurationSeconds.observe(
                { tenantId: input.tenantId, searchType },
                durationSeconds
            );
        }
    }

    async findByTenantId(tenantId: string, limit: number = 20): Promise<Memory[]> {
        const docs = await this.collection
            .find({ tenantId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toDomain(doc));
    }

    async findByWorkspaceId(workspaceId: string, limit: number = 20): Promise<Memory[]> {
        const docs = await this.collection
            .find({ workspaceId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toDomain(doc));
    }

    async findById(id: string, tenantId: string): Promise<Memory | null> {
        const doc = await this.collection.findOne({ _id: id, tenantId });
        if (!doc) return null;

        return this.toDomain(doc);
    }

    async delete(id: string, tenantId: string): Promise<boolean> {
        const result = await this.collection.deleteOne({ _id: id, tenantId });
        return result.deletedCount > 0;
    }

    async searchHybrid(input: HybridMemorySearchInput): Promise<HybridSearchResult[]> {
        const limit = input.limit ?? 5;
        const relevant = await this.searchRelevant({
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            query: input.query,
            vector: input.vector,
            limit,
            threshold: input.threshold,
        });

        return relevant.map((memory, index) => ({
            memory,
            score: memory.importance,
            vectorRank: index + 1,
            textRank: index + 1,
        }));
    }

    async updateStatus(
        id: string,
        tenantId: string,
        status: MemoryStatus,
        metadata?: Record<string, unknown>
    ): Promise<boolean> {
        const updateDoc: Record<string, unknown> = {
            status,
            updatedAt: new Date(),
        };
        if (metadata) {
            updateDoc.metadata = metadata;
        }
        const result = await this.collection.updateOne(
            { _id: id, tenantId },
            { $set: updateDoc }
        );
        return result.matchedCount > 0;
    }

    async findCandidates(tenantId: string, limit: number = 20): Promise<Memory[]> {
        const docs = await this.collection
            .find({ tenantId, status: 'candidate' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toDomain(doc));
    }

    async findExpired(now: Date = new Date(), limit: number = 100): Promise<Memory[]> {
        const docs = await this.collection
            .find({
                expiresAt: { $lte: now, $exists: true, $ne: null } as any,
                status: { $ne: 'expired' }
            })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toDomain(doc));
    }

    async purgeExpired(now: Date = new Date()): Promise<number> {
        const result = await this.collection.deleteMany({
            expiresAt: { $lte: now, $exists: true, $ne: null } as any
        });
        return result.deletedCount;
    }

    private calculateCosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private toDocument(memory: Memory): MemoryDocument {
        return {
            _id: memory.id,
            tenantId: memory.tenantId,
            workspaceId: memory.workspaceId,
            threadId: memory.threadId,
            type: memory.type,
            status: memory.status || 'active',
            content: memory.content,
            importance: memory.importance,
            confidenceScore: memory.confidenceScore,
            tags: memory.tags,
            ttlSeconds: memory.ttlSeconds,
            expiresAt: memory.expiresAt,
            validatedBy: memory.validatedBy,
            embedding: memory.embedding,
            metadata: memory.metadata,
            createdAt: memory.createdAt ?? new Date(),
            updatedAt: memory.updatedAt ?? new Date(),
        };
    }

    private toDomain(doc: MemoryDocument): Memory {
        return {
            id: doc._id,
            tenantId: doc.tenantId,
            workspaceId: doc.workspaceId,
            threadId: doc.threadId,
            type: doc.type,
            status: doc.status || 'active',
            content: doc.content,
            importance: doc.importance,
            confidenceScore: doc.confidenceScore,
            tags: doc.tags,
            ttlSeconds: doc.ttlSeconds,
            expiresAt: doc.expiresAt,
            validatedBy: doc.validatedBy,
            embedding: doc.embedding,
            metadata: doc.metadata,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }
}
