import type { Redis } from 'ioredis';
import { MongoConnection } from '../database/MongoConnection.js';
import { logger } from '../../config/logger.js';

export interface HealthCheckResult {
    mongodb: 'ok' | 'fail';
    redis: 'ok' | 'fail';
}

export interface ReadinessStatus {
    status: 'ready' | 'degraded';
    checks: HealthCheckResult;
}

export class HealthChecker {
    private readonly log = logger.child({ module: 'HealthChecker' });
    private readonly redisClient?: Redis | null;
    private readonly mongoPingFn?: () => Promise<boolean>;

    constructor(options?: { redisClient?: Redis | null; mongoPingFn?: () => Promise<boolean> }) {
        this.redisClient = options?.redisClient;
        this.mongoPingFn = options?.mongoPingFn;
    }

    async checkMongo(): Promise<boolean> {
        try {
            if (this.mongoPingFn) {
                return await this.mongoPingFn();
            }
            return await MongoConnection.ping();
        } catch (error) {
            this.log.error({ err: error }, 'Erro ao verificar saúde do MongoDB');
            return false;
        }
    }

    async checkRedis(): Promise<boolean> {
        if (!this.redisClient) {
            return false;
        }
        try {
            const pong = await this.redisClient.ping();
            return pong === 'PONG';
        } catch (error) {
            this.log.error({ err: error }, 'Erro ao verificar saúde do Redis');
            return false;
        }
    }

    async checkReadiness(): Promise<ReadinessStatus> {
        const [mongoOk, redisOk] = await Promise.all([
            this.checkMongo(),
            this.checkRedis(),
        ]);

        const checks: HealthCheckResult = {
            mongodb: mongoOk ? 'ok' : 'fail',
            redis: redisOk ? 'ok' : 'fail',
        };

        const status = mongoOk && redisOk ? 'ready' : 'degraded';

        return {
            status,
            checks,
        };
    }
}
