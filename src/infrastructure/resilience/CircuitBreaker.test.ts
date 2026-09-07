import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    CircuitBreaker,
    CircuitState,
    CircuitBreakerOpenError,
    circuitBreakerStateGauge,
    circuitBreakerFailuresCounter
} from './CircuitBreaker.js';

describe('CircuitBreaker', () => {
    let cb: CircuitBreaker;

    beforeEach(() => {
        vi.restoreAllMocks();
        cb = new CircuitBreaker({
            name: 'test-circuit',
            failureThreshold: 3,
            resetTimeoutMs: 1000,
            halfOpenMaxCalls: 1,
        });
    });

    it('inicia no estado CLOSED', () => {
        expect(cb.getState()).toBe(CircuitState.CLOSED);
        expect(cb.isOpen()).toBe(false);
    });

    it('executa função com sucesso mantendo estado CLOSED', async () => {
        const fn = vi.fn().mockResolvedValue('sucesso');
        const result = await cb.execute(fn);

        expect(result).toBe('sucesso');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('abre o circuito após atingir o threshold de falhas', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Falha de rede'));

        // 1ª falha
        await expect(cb.execute(failingFn)).rejects.toThrow('Falha de rede');
        expect(cb.getState()).toBe(CircuitState.CLOSED);

        // 2ª falha
        await expect(cb.execute(failingFn)).rejects.toThrow('Falha de rede');
        expect(cb.getState()).toBe(CircuitState.CLOSED);

        // 3ª falha (threshold = 3) -> abre o circuito
        await expect(cb.execute(failingFn)).rejects.toThrow('Falha de rede');
        expect(cb.getState()).toBe(CircuitState.OPEN);
        expect(cb.isOpen()).toBe(true);

        // Chamada subsequente deve lançar CircuitBreakerOpenError sem executar a função
        const afterOpenFn = vi.fn().mockResolvedValue('ok');
        await expect(cb.execute(afterOpenFn)).rejects.toThrow(CircuitBreakerOpenError);
        expect(afterOpenFn).not.toHaveBeenCalled();
    });

    it('transiciona para HALF_OPEN após expirar o resetTimeoutMs', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Erro'));
        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(failingFn)).rejects.toThrow();
        }
        expect(cb.getState()).toBe(CircuitState.OPEN);

        // Avança o tempo além de 1000ms
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);

        expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
        expect(cb.isOpen()).toBe(false);
    });

    it('fecha o circuito se chamada de teste em HALF_OPEN for bem-sucedida', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Erro'));
        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(failingFn)).rejects.toThrow();
        }
        expect(cb.getState()).toBe(CircuitState.OPEN);

        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
        expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

        // Chamada bem-sucedida fecha o circuito
        const successFn = vi.fn().mockResolvedValue('recuperado');
        const res = await cb.execute(successFn);

        expect(res).toBe('recuperado');
        expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('reabre o circuito imediatamente se chamada falhar em HALF_OPEN', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Erro'));
        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(failingFn)).rejects.toThrow();
        }
        expect(cb.getState()).toBe(CircuitState.OPEN);

        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
        expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

        // Falha durante HALF_OPEN
        await expect(cb.execute(failingFn)).rejects.toThrow('Erro');
        expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('limita as chamadas em HALF_OPEN conforme halfOpenMaxCalls', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Erro'));
        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(failingFn)).rejects.toThrow();
        }

        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now + 1500);
        expect(cb.getState()).toBe(CircuitState.HALF_OPEN);

        // Primeira chamada em HALF_OPEN roda
        let resolveFn: (val: any) => void;
        const pendingPromise = new Promise((resolve) => { resolveFn = resolve; });
        const call1 = cb.execute(() => pendingPromise);

        // Segunda chamada em paralelo enquanto a primeira ainda está executando deve ser bloqueada
        await expect(cb.execute(() => Promise.resolve('extra'))).rejects.toThrow(CircuitBreakerOpenError);

        resolveFn!('ok');
        await call1;
        expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('reset() restaura o estado para CLOSED e zera falhas', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('Erro'));
        for (let i = 0; i < 3; i++) {
            await expect(cb.execute(failingFn)).rejects.toThrow();
        }
        expect(cb.getState()).toBe(CircuitState.OPEN);

        cb.reset();
        expect(cb.getState()).toBe(CircuitState.CLOSED);
        expect(cb.isOpen()).toBe(false);
    });

    it('registra métricas no Prometheus ao falhar e alterar estados', async () => {
        const gaugeSpy = vi.spyOn(circuitBreakerStateGauge, 'set');
        const counterSpy = vi.spyOn(circuitBreakerFailuresCounter, 'inc');

        const failingFn = vi.fn().mockRejectedValue(new Error('Erro teste'));
        await expect(cb.execute(failingFn)).rejects.toThrow();

        expect(counterSpy).toHaveBeenCalledWith({ name: 'test-circuit' });
    });
});
