import type { Message } from "../Message.js";

export interface ShortTermMemoryContext {
    workspaceId: string;
    threadId: string;
    recentMessages: Message[];
    metadata?: Record<string, unknown>;
    updatedAt: Date;
}

export interface IShortTermMemory {
    get(workspaceId: string, threadId: string): Promise<ShortTermMemoryContext | null>;
    set(workspaceId: string, threadId: string, messages: Message[], ttlSeconds?: number): Promise<void>;
    clear(workspaceId: string, threadId: string): Promise<void>;
}
