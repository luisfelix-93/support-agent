import { describe, it, expect, vi } from 'vitest';
import { RetryPolicy } from './RetryPolicy.js';
import { CircuitBreakerOpenError } from './CircuitBreaker.js';

describe('RetryPolicy', () => {
    it('executa função com sucesso na primeira tentativa sem chamar sleep', async () => {
        const sleepMock = vi.fn().mockResolvedValue(undefined);
        const policy = new RetryPolicy({ maxRetries: 3, sleepFn: sleepMock });

        const fn = vi.fn().mockResolvedValue('ok');
        const res = await policy.execute(fn);

        expect(res).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(sleepMock).not.toHaveBeenCalled();
    });

    it('retenta em erros transitórios e retorna resultado após sucesso', async () => {
        const sleepMock = vi.fn().mockResolvedValue(undefined);
        const policy = new RetryPolicy({ maxRetries: 3, baseDelayMs: 100, sleepFn: sleepMock });

        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('fetch failed'))
            .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
            .mockResolvedValueOnce('sucesso final');

        const res = await policy.execute(fn);

        expect(res).toBe('sucesso final');
        expect(fn).toHaveBeenCalledTimes(3);
        expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it('não retenta em erros 4xx de cliente e lança o erro imediatamente', async () => {
        const sleepMock = vi.fn().mockResolvedValue(undefined);
        const policy = new RetryPolicy({ maxRetries: 3, sleepFn: sleepMock });

        const badRequestError = { status: 400, message: 'Bad Request' };
        const fn = vi.fn().mockRejectedValue(badRequestError);

        await expect(policy.execute(fn)).rejects.toEqual(badRequestError);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(sleepMock).not.toHaveBeenCalled();
    });

    it('não retenta em CircuitBreakerOpenError', async () => {
        const sleepMock = vi.fn().mockResolvedValue(undefined);
        const policy = new RetryPolicy({ maxRetries: 3, sleepFn: sleepMock });

        const cbError = new CircuitBreakerOpenError('mcp', Date.now() + 10000);
        const fn = vi.fn().mockRejectedValue(cbError);

        await expect(policy.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(sleepMock).not.toHaveBeenCalled();
    });

    it('lança o erro após exceder maxRetries em falhas transitórias contínuas', async () => {
        const sleepMock = vi.fn().mockResolvedValue(undefined);
        const policy = new RetryPolicy({ maxRetries: 2, sleepFn: sleepMock });

        const networkError = new Error('ECONNRESET: connection reset by peer');
        const fn = vi.fn().mockRejectedValue(networkError);

        await expect(policy.execute(fn)).rejects.toThrow('ECONNRESET');
        // Tentativa inicial (1) + 2 retries = 3 chamadas
        expect(fn).toHaveBeenCalledTimes(3);
        expect(sleepMock).toHaveBeenCalledTimes(2);
    });

    it('isRetryable identifica corretamente códigos transitórios e HTTP 502/503/504', () => {
        const policy = new RetryPolicy();

        expect(policy.isRetryable(new Error('ECONNRESET'))).toBe(true);
        expect(policy.isRetryable(new Error('ETIMEDOUT'))).toBe(true);
        expect(policy.isRetryable(new Error('fetch failed'))).toBe(true);
        expect(policy.isRetryable({ status: 502 })).toBe(true);
        expect(policy.isRetryable({ status: 503 })).toBe(true);
        expect(policy.isRetryable({ status: 504 })).toBe(true);

        expect(policy.isRetryable({ status: 400 })).toBe(false);
        expect(policy.isRetryable({ status: 401 })).toBe(false);
        expect(policy.isRetryable({ status: 403 })).toBe(false);
        expect(policy.isRetryable({ status: 404 })).toBe(false);
        expect(policy.isRetryable(new CircuitBreakerOpenError('test', 123))).toBe(false);
    });
});
