export type MemoryType =
    | 'fact'
    | 'preference'
    | 'incident'
    | 'resolution'
    | 'knowledge'
    | 'summary';

export interface Memory {
    id: string;
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

export interface MemorySearchInput {
    tenantId: string;
    workspaceId: string;
    query: string;
    limit?: number;
    threshold?: number;
}
