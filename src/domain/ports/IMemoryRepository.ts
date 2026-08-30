import type { Memory, MemorySearchInput } from "../Memory.js";

export interface IMemoryRepository {
    save(memory: Memory): Promise<void>;
    saveBatch(memories: Memory[]): Promise<void>;
    searchRelevant(input: MemorySearchInput): Promise<Memory[]>;
    findByTenantId(tenantId: string, limit?: number): Promise<Memory[]>;
    findByWorkspaceId(workspaceId: string, limit?: number): Promise<Memory[]>;
    findById(id: string, tenantId: string): Promise<Memory | null>;
    delete(id: string, tenantId: string): Promise<boolean>;
}
