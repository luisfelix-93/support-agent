import { logger } from '../../config/logger.js';
import { CircuitBreakerOpenError } from './CircuitBreaker.js';

export interface RetryPolicyConfig {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
}

export class RetryPolicy {
    public readonly maxRetries: number;
    public readonly baseDelayMs: number;
    public readonly maxDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private readonly log = logger.child({ module: 'RetryPolicy' });

    constructor(config: RetryPolicyConfig = {}) {
        this.maxRetries = config.maxRetries ?? 3;
        this.baseDelayMs = config.baseDelayMs ?? 1000;
        this.maxDelayMs = config.maxDelayMs ?? 10000;
        this.sleep = config.sleepFn ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
    }

    /**
     * Identifica se um erro é transitório e passível de retry.
     * Rejeita erros 4xx de negócio e erros de circuito aberto.
     */
    isRetryable(error: any): boolean {
        if (!error) return false;

        // Se o circuito já está aberto, não adianta tentar novamente de imediato
        if (error instanceof CircuitBreakerOpenError || error?.name === 'CircuitBreakerOpenError') {
            return false;
        }

        // Abort proposital
        if (error.name === 'AbortError') {
            return false;
        }

        // Verifica código HTTP de status caso disponível
        const status = error.status ?? error.statusCode ?? error.response?.status;
        if (typeof status === 'number') {
            if ([502, 503, 504].includes(status)) {
                return true;
            }
            if (status >= 400 && status < 500) {
                return false;
            }
        }

        const msg = String(error.message ?? error).toLowerCase();
        const code = String(error.code ?? '').toUpperCase();

        // Códigos de erro de rede do Node.js (via code ou na mensagem)
        const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'];
        for (const c of transientCodes) {
            if (code === c || msg.includes(c.toLowerCase())) {
                return true;
            }
        }

        // Padrões de mensagens de falha transitória de rede e status 502/503/504
        if (
            msg.includes('fetch failed') ||
            msg.includes('network error') ||
            msg.includes('socket hang up') ||
            msg.includes('gateway timeout') ||
            msg.includes('bad gateway') ||
            msg.includes('service unavailable') ||
            msg.includes('temporarily unavailable') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('504')
        ) {
            return true;
        }

        return false;
    }

    /**
     * Executa a função fornecida aplicando retry exponencial com jitter para erros transitórios.
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        let attempt = 0;

        while (true) {
            try {
                return await fn();
            } catch (error: any) {
                attempt++;

                if (attempt > this.maxRetries || !this.isRetryable(error)) {
                    throw error;
                }

                const exponentialBackoff = this.baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = Math.random() * (this.baseDelayMs * 0.5);
                const delayMs = Math.min(this.maxDelayMs, Math.round(exponentialBackoff + jitter));

                this.log.warn(
                    {
                        attempt,
                        maxRetries: this.maxRetries,
                        delayMs,
                        err: error?.message ?? error,
                    },
                    'Erro transitório detectado. Aguardando para retentar...'
                );

                await this.sleep(delayMs);
            }
        }
    }
}
