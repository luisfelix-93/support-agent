import type { MessageRole } from "./Message.js";

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
    importance: number; // 0.0 a 1.0
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
    type?: MemoryType;
}

export interface MemoryPromotionJobData {
    tenantId: string;
    workspaceId: string;
    threadId: string;
    messages: Array<{ role: MessageRole; content: string }>;
    traceContext?: Record<string, string>;
}
