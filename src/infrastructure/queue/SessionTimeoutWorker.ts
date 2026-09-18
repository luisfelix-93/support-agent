import type { SessionTimeoutSweeper, SweepResult } from '../../services/SessionTimeoutSweeper.js';
import { logger } from '../../config/logger.js';

const log = logger.child({ module: 'SessionTimeoutWorker' });

export class SessionTimeoutWorker {
    private intervalHandle: NodeJS.Timeout | null = null;
    private isBusy = false;

    constructor(
        private readonly sweeper: SessionTimeoutSweeper,
        private readonly defaultIntervalMs: number = 60000
    ) {}

    start(intervalMs?: number): void {
        if (this.intervalHandle) {
            log.warn('SessionTimeoutWorker já está em execução.');
            return;
        }

        const interval = intervalMs ?? this.defaultIntervalMs;
        log.info({ intervalMs: interval }, 'Iniciando SessionTimeoutWorker.');

        this.intervalHandle = setInterval(async () => {
            if (this.isBusy) {
                log.debug('Ciclo anterior de varredura ainda em andamento, ignorando tick.');
                return;
            }

            this.isBusy = true;
            try {
                const result = await this.sweeper.sweepExpiredSessions();
                if (result.expired > 0) {
                    log.info({ expired: result.expired, scanned: result.scanned }, 'Varredura periódica de sessões concluída.');
                }
            } catch (error) {
                log.error({ err: error }, 'Erro durante ciclo do SessionTimeoutWorker.');
            } finally {
                this.isBusy = false;
            }
        }, interval);

        if (typeof this.intervalHandle.unref === 'function') {
            this.intervalHandle.unref();
        }
    }

    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
            log.info('SessionTimeoutWorker parado com sucesso.');
        }
    }

    isRunning(): boolean {
        return this.intervalHandle !== null;
    }

    async triggerNow(): Promise<SweepResult> {
        log.info('Disparo manual de varredura acionado.');
        return await this.sweeper.sweepExpiredSessions();
    }
}
