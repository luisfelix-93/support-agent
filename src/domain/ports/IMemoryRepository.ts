import type {
    Memory,
    MemorySearchInput,
    HybridMemorySearchInput,
    HybridSearchResult,
    MemoryStatus
} from "../Memory.js";

export interface IMemoryRepository {
    save(memory: Memory): Promise<void>;
    saveBatch(memories: Memory[]): Promise<void>;
    searchRelevant(input: MemorySearchInput): Promise<Memory[]>;
    searchHybrid(input: HybridMemorySearchInput): Promise<HybridSearchResult[]>;
    findByTenantId(tenantId: string, limit?: number): Promise<Memory[]>;
    findByWorkspaceId(workspaceId: string, limit?: number): Promise<Memory[]>;
    findById(id: string, tenantId: string): Promise<Memory | null>;
    delete(id: string, tenantId: string): Promise<boolean>;
    updateStatus(id: string, tenantId: string, status: MemoryStatus, metadata?: Record<string, unknown>): Promise<boolean>;
    findCandidates(tenantId: string, limit?: number): Promise<Memory[]>;
    findExpired(now?: Date, limit?: number): Promise<Memory[]>;
    purgeExpired(now?: Date): Promise<number>;
}
