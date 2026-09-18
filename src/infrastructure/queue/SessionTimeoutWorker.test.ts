import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTimeoutWorker } from './SessionTimeoutWorker.js';
import type { SessionTimeoutSweeper, SweepResult } from '../../services/SessionTimeoutSweeper.js';

describe('SessionTimeoutWorker', () => {
    let mockSweeper: SessionTimeoutSweeper;
    let worker: SessionTimeoutWorker;

    beforeEach(() => {
        vi.useFakeTimers();
        mockSweeper = {
            sweepExpiredSessions: vi.fn().mockResolvedValue({
                scanned: 2,
                expired: 1,
                errors: 0,
            } as SweepResult),
        } as any;

        worker = new SessionTimeoutWorker(mockSweeper);
    });

    afterEach(() => {
        worker.stop();
        vi.useRealTimers();
    });

    it('deve inicializar e relatar isRunning corretamente', () => {
        expect(worker.isRunning()).toBe(false);

        worker.start(5000);
        expect(worker.isRunning()).toBe(true);

        worker.stop();
        expect(worker.isRunning()).toBe(false);
    });

    it('não deve iniciar múltiplos timers se já estiver rodando', () => {
        worker.start(5000);
        worker.start(5000); // Segunda chamada no-op

        expect(worker.isRunning()).toBe(true);
    });

    it('deve executar o sweeper periodicamente no intervalo configurado', async () => {
        worker.start(10000);

        expect(mockSweeper.sweepExpiredSessions).not.toHaveBeenCalled();

        // Avança 10 segundos
        await vi.advanceTimersByTimeAsync(10000);
        expect(mockSweeper.sweepExpiredSessions).toHaveBeenCalledTimes(1);

        // Avança mais 10 segundos
        await vi.advanceTimersByTimeAsync(10000);
        expect(mockSweeper.sweepExpiredSessions).toHaveBeenCalledTimes(2);
    });

    it('deve permitir disparar varredura manual imediata com triggerNow()', async () => {
        const result = await worker.triggerNow();

        expect(mockSweeper.sweepExpiredSessions).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ scanned: 2, expired: 1, errors: 0 });
    });

    it('deve capturar e logar exceção sem quebrar o loop periódico', async () => {
        vi.mocked(mockSweeper.sweepExpiredSessions).mockRejectedValueOnce(new Error('Sweeper crash'));

        worker.start(5000);

        // Primeiro tick: rejeita, mas worker trata
        await vi.advanceTimersByTimeAsync(5000);
        expect(mockSweeper.sweepExpiredSessions).toHaveBeenCalledTimes(1);

        // Segundo tick: continua funcionando normalmente
        vi.mocked(mockSweeper.sweepExpiredSessions).mockResolvedValueOnce({ scanned: 0, expired: 0, errors: 0 });
        await vi.advanceTimersByTimeAsync(5000);
        expect(mockSweeper.sweepExpiredSessions).toHaveBeenCalledTimes(2);
    });
});
