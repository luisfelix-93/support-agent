import { describe, it, expect, vi } from 'vitest';
import { IdempotencyGuard } from './IdempotencyGuard.js';

describe('IdempotencyGuard', () => {
    it('retorna false quando a chave é inserida pela primeira vez (SET NX retorna OK)', async () => {
        const redisMock = {
            set: vi.fn().mockResolvedValue('OK'),
        };

        const guard = new IdempotencyGuard(redisMock, { ttlSeconds: 1800, prefix: 'test-idemp:' });
        const isDup = await guard.isDuplicate('msg-123');

        expect(isDup).toBe(false);
        expect(redisMock.set).toHaveBeenCalledWith('test-idemp:msg-123', '1', 'EX', 1800, 'NX');
    });

    it('retorna true quando a chave já existe (SET NX retorna null)', async () => {
        const redisMock = {
            set: vi.fn().mockResolvedValue(null),
        };

        const guard = new IdempotencyGuard(redisMock);
        const isDup = await guard.isDuplicate('msg-already-seen');

        expect(isDup).toBe(true);
        expect(redisMock.set).toHaveBeenCalledWith('idempotency:msg-already-seen', '1', 'EX', 3600, 'NX');
    });

    it('retorna false (fail-open) se o Redis lançar uma exceção', async () => {
        const redisMock = {
            set: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        };

        const guard = new IdempotencyGuard(redisMock);
        const isDup = await guard.isDuplicate('msg-error');

        // Não quebra a requisição do usuário, loga e permite continuar
        expect(isDup).toBe(false);
    });
});
