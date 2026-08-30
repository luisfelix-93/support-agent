import type { Collection } from "mongodb";
import { MongoConnection } from "../infrastructure/database/MongoConnection.js";
import type { Memory, MemorySearchInput, MemoryType } from "../domain/Memory.js";
import type { IMemoryRepository } from "../domain/ports/IMemoryRepository.js";
import { logger } from "../config/logger.js";

const log = logger.child({ module: 'MongoMemoryRepository' });

export interface MemoryDocument {
    _id: string;
    tenantId: string;
    workspaceId: string;
    threadId?: string;
    type: MemoryType;
    content: string;
    importance: number;
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
        log.debug({ count: memories.length }, 'Lote de memórias salvo com sucesso.');
    }

    async searchRelevant(input: MemorySearchInput): Promise<Memory[]> {
        const filter: any = {
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
        };

        if (input.type) {
            filter.type = input.type;
        }

        if (input.query && input.query.trim()) {
            // Busca textual usando regex simples com proteção para caracteres especiais
            const escapedQuery = input.query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.content = { $regex: escapedQuery, $options: 'i' };
        }

        const limit = input.limit ?? 5;
        const docs = await this.collection
            .find(filter)
            .sort({ importance: -1, createdAt: -1 })
            .limit(limit)
            .toArray();

        return docs.map(doc => this.toDomain(doc));
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

    private toDocument(memory: Memory): MemoryDocument {
        return {
            _id: memory.id,
            tenantId: memory.tenantId,
            workspaceId: memory.workspaceId,
            threadId: memory.threadId,
            type: memory.type,
            content: memory.content,
            importance: memory.importance,
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
            content: doc.content,
            importance: doc.importance,
            embedding: doc.embedding,
            metadata: doc.metadata,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }
}
