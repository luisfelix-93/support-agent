import type { Redis } from 'ioredis';
import { logger } from '../../config/logger.js';

export interface IdempotencyGuardConfig {
    ttlSeconds?: number;
    prefix?: string;
}

export class IdempotencyGuard {
    public readonly ttlSeconds: number;
    public readonly prefix: string;
    private readonly log = logger.child({ module: 'IdempotencyGuard' });

    constructor(
        private readonly redis: Redis | any,
        config: IdempotencyGuardConfig = {}
    ) {
        this.ttlSeconds = config.ttlSeconds ?? 3600;
        this.prefix = config.prefix ?? 'idempotency:';
    }

    /**
     * Verifica se a chave fornecida já foi processada anteriormente.
     * Retorna `false` se é a primeira vez (chave registrada com sucesso).
     * Retorna `true` se a chave já existe (duplicata detectada).
     */
    async isDuplicate(key: string): Promise<boolean> {
        const fullKey = `${this.prefix}${key}`;
        try {
            // SET key value EX ttl NX -> retorna 'OK' se a chave não existia, ou null se já existia
            const result = await this.redis.set(fullKey, '1', 'EX', this.ttlSeconds, 'NX');

            const isDuplicated = result !== 'OK';
            if (isDuplicated) {
                this.log.info({ key: fullKey }, 'Requisição duplicada identificada pelo IdempotencyGuard.');
            }
            return isDuplicated;
        } catch (error) {
            // Em caso de falha de conexão com o Redis, optamos por fail-open com log para não interromper o serviço
            this.log.error({ err: error, key: fullKey }, 'Erro ao consultar IdempotencyGuard no Redis. Permitindo requisição (fail-open).');
            return false;
        }
    }
}
