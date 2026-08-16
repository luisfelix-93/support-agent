import type { Redis } from "ioredis";
import type { IShortTermMemory, ShortTermMemoryContext } from "../../domain/ports/IShortTermMemory.js";
import { Message } from "../../domain/Message.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: 'RedisShortTermMemory' });
const DEFAULT_TTL_SECONDS = Number(process.env.SHORT_TERM_MEMORY_TTL) || 3600;

export class RedisShortTermMemory implements IShortTermMemory {
    constructor(private readonly redis: Redis) {}

    private buildKey(workspaceId: string, threadId: string): string {
        return `memory:short:${workspaceId}:${threadId}`;
    }

    async get(workspaceId: string, threadId: string): Promise<ShortTermMemoryContext | null> {
        try {
            const key = this.buildKey(workspaceId, threadId);
            const data = await this.redis.get(key);
            if (!data) return null;

            const parsed = JSON.parse(data);
            const recentMessages = (parsed.recentMessages || []).map(
                (m: any) => new Message(m.id, m.role, m.content)
            );

            return {
                workspaceId: parsed.workspaceId,
                threadId: parsed.threadId,
                recentMessages,
                metadata: parsed.metadata,
                updatedAt: new Date(parsed.updatedAt)
            };
        } catch (error) {
            log.warn({ err: error, workspaceId, threadId }, 'Falha ao recuperar Short-Term Memory do Redis.');
            return null;
        }
    }

    async set(
        workspaceId: string,
        threadId: string,
        messages: Message[],
        ttlSeconds: number = DEFAULT_TTL_SECONDS
    ): Promise<void> {
        try {
            const key = this.buildKey(workspaceId, threadId);
            const payload: ShortTermMemoryContext = {
                workspaceId,
                threadId,
                recentMessages: messages,
                updatedAt: new Date()
            };

            await this.redis.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
        } catch (error) {
            log.warn({ err: error, workspaceId, threadId }, 'Falha ao persistir Short-Term Memory no Redis.');
        }
    }

    async clear(workspaceId: string, threadId: string): Promise<void> {
        try {
            const key = this.buildKey(workspaceId, threadId);
            await this.redis.del(key);
        } catch (error) {
            log.warn({ err: error, workspaceId, threadId }, 'Falha ao limpar Short-Term Memory no Redis.');
        }
    }
}
