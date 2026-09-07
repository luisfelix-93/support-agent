import client from 'prom-client';
import { metricsRegister } from '../../config/metrics.js';
import { logger } from '../../config/logger.js';

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN',
}

const STATE_NUMERIC: Record<CircuitState, number> = {
    [CircuitState.CLOSED]: 0,
    [CircuitState.OPEN]: 1,
    [CircuitState.HALF_OPEN]: 2,
};

// Métricas Prometheus compartilhadas entre todas as instâncias de CircuitBreaker
export const circuitBreakerStateGauge = new client.Gauge({
    name: 'circuit_breaker_state',
    help: 'Estado atual do circuit breaker (0 = CLOSED, 1 = OPEN, 2 = HALF_OPEN)',
    labelNames: ['name'],
    registers: [metricsRegister],
});

export const circuitBreakerFailuresCounter = new client.Counter({
    name: 'circuit_breaker_failures_total',
    help: 'Total de falhas registradas no circuit breaker',
    labelNames: ['name'],
    registers: [metricsRegister],
});

export class CircuitBreakerOpenError extends Error {
    constructor(
        public readonly circuitName: string,
        public readonly nextAttemptAt: number
    ) {
        const remainingSeconds = Math.max(0, Math.ceil((nextAttemptAt - Date.now()) / 1000));
        super(
            `[CircuitBreaker:${circuitName}] Circuito está ABERTO. Próxima tentativa permitida em ~${remainingSeconds}s.`
        );
        this.name = 'CircuitBreakerOpenError';
    }
}

export interface CircuitBreakerConfig {
    name?: string;
    failureThreshold?: number;
    resetTimeoutMs?: number;
    halfOpenMaxCalls?: number;
}

export class CircuitBreaker {
    public readonly name: string;
    public readonly failureThreshold: number;
    public readonly resetTimeoutMs: number;
    public readonly halfOpenMaxCalls: number;

    private state: CircuitState = CircuitState.CLOSED;
    private failureCount: number = 0;
    private halfOpenCalls: number = 0;
    private nextAttemptAt: number = 0;
    private readonly log = logger.child({ module: 'CircuitBreaker' });

    constructor(config: CircuitBreakerConfig = {}) {
        this.name = config.name ?? 'default';
        this.failureThreshold = config.failureThreshold ?? 5;
        this.resetTimeoutMs = config.resetTimeoutMs ?? 30000;
        this.halfOpenMaxCalls = config.halfOpenMaxCalls ?? 1;

        circuitBreakerStateGauge.set({ name: this.name }, STATE_NUMERIC[this.state]);
    }

    getState(): CircuitState {
        // Se estiver aberto e o tempo de reset tiver expirado, transiciona para HALF_OPEN
        if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttemptAt) {
            this.transitionTo(CircuitState.HALF_OPEN);
        }
        return this.state;
    }

    isOpen(): boolean {
        return this.getState() === CircuitState.OPEN;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        const currentState = this.getState();

        if (currentState === CircuitState.OPEN) {
            throw new CircuitBreakerOpenError(this.name, this.nextAttemptAt);
        }

        if (currentState === CircuitState.HALF_OPEN) {
            if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
                throw new CircuitBreakerOpenError(this.name, this.nextAttemptAt);
            }
            this.halfOpenCalls++;
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    reset(): void {
        this.failureCount = 0;
        this.halfOpenCalls = 0;
        this.nextAttemptAt = 0;
        this.transitionTo(CircuitState.CLOSED);
    }

    private onSuccess(): void {
        if (this.state === CircuitState.HALF_OPEN) {
            this.log.info({ name: this.name }, 'Chamada de teste bem-sucedida em HALF_OPEN. Fechando circuito.');
            this.reset();
        } else if (this.state === CircuitState.CLOSED) {
            this.failureCount = 0;
        }
    }

    private onFailure(error: any): void {
        this.failureCount++;
        circuitBreakerFailuresCounter.inc({ name: this.name });

        this.log.warn(
            { name: this.name, failures: this.failureCount, state: this.state, err: error?.message ?? error },
            'Falha detectada na execução do Circuit Breaker.'
        );

        if (this.state === CircuitState.HALF_OPEN) {
            this.log.warn({ name: this.name }, 'Falha durante HALF_OPEN. Reabrindo circuito imediatamente.');
            this.openCircuit();
        } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
            this.log.warn(
                { name: this.name, threshold: this.failureThreshold },
                'Threshold de falhas atingido. Abrindo circuito.'
            );
            this.openCircuit();
        }
    }

    private openCircuit(): void {
        this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
        this.halfOpenCalls = 0;
        this.transitionTo(CircuitState.OPEN);
    }

    private transitionTo(newState: CircuitState): void {
        if (this.state !== newState) {
            this.log.info({ name: this.name, from: this.state, to: newState }, 'Transição de estado do CircuitBreaker.');
            this.state = newState;
            circuitBreakerStateGauge.set({ name: this.name }, STATE_NUMERIC[newState]);
        }
    }
}
