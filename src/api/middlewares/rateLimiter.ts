import type { Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Redis } from 'ioredis';
import { logger } from '../../config/logger.js';

const log = logger.child({ module: 'rateLimiter' });

const isTest = process.env.NODE_ENV === 'test';

let redisClient: Redis | null = null;

if (!isTest && (process.env.REDIS_URL || process.env.REDIS_HOST)) {
    try {
        redisClient = process.env.REDIS_URL
            ? new Redis(process.env.REDIS_URL)
            : new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: Number(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
            });

        redisClient.on('error', (err) => {
            log.error({ err }, 'Erro de conexão com o Redis do rate limiter');
        });

        log.info('RedisStore do rate limiter inicializado com sucesso.');
    } catch (error) {
        log.error({ err: error }, 'Erro ao criar RedisStore. Usando fallback em memória.');
        redisClient = null;
    }
} else {
    log.info('Armazenamento em memória ativado (Redis não configurado ou ambiente de testes).');
}

function createRedisStore(prefix: string): RedisStore | undefined {
    if (!redisClient) return undefined;
    return new RedisStore({
        // @ts-ignore
        sendCommand: (...args: string[]) => redisClient!.call(args[0], ...args.slice(1)),
        prefix,
    });
}

// Limiter geral para API (100 requisições por 15 minutos)
export const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 100, // limite de 100 requisições por IP
    standardHeaders: true, // Retorna RateLimit-* headers
    legacyHeaders: false, // Desabilita X-RateLimit-* headers
    store: createRedisStore('rl:api:'),
    skip: (req) => {
        // Ignora rotas de healthcheck e as rotas de auth/onboarding que possuem seu próprio limiter estrito
        return (
            req.path === '/health' ||
            req.path === '/api/health' ||
            req.path === '/api/health/ready' ||
            req.path.startsWith('/health') ||
            req.path.startsWith('/api/health') ||
            req.path.startsWith('/auth') ||
            req.path.startsWith('/api/auth') ||
            req.path.startsWith('/onboarding') ||
            req.path.startsWith('/api/onboarding')
        );
    },
    message: {
        error: 'Too many requests, please try again later.',
        status: 429
    }
});

// Limiter mais rígido para autenticação e onboarding (10 requisições por 15 minutos)
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 10, // limite de 10 requisições por IP
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore('rl:auth:'),
    message: {
        error: 'Too many login or registration attempts. Please try again after 15 minutes.',
        status: 429
    }
});

// Limiter por tenant (200 requisições por 15 minutos por tenant)
export const tenantRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    limit: 200, // limite de 200 requisições por tenant
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false },
    store: createRedisStore('rl:tenant:'),
    keyGenerator: (req: Request): string => {
        if (req.user?.workspaceIds && req.user.workspaceIds.length > 0) {
            return `tenant:${req.user.workspaceIds[0]}`;
        }
        return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
    },
    skip: (req) => {
        return (
            req.path === '/health' ||
            req.path === '/api/health' ||
            req.path === '/api/health/ready' ||
            req.path.startsWith('/health') ||
            req.path.startsWith('/api/health')
        );
    },
    message: {
        error: 'Too many requests for this tenant, please try again later.',
        status: 429
    }
});

