import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceLedger } from './EvidenceLedger.js';

describe('EvidenceLedger', () => {
    let ledger: EvidenceLedger;

    beforeEach(() => {
        ledger = new EvidenceLedger();
    });

    it('deve inicializar vazio sem evidências', () => {
        expect(ledger.hasEvidence()).toBe(false);
        expect(ledger.getLogs()).toHaveLength(0);
        expect(ledger.getMetrics()).toHaveLength(0);
        expect(ledger.getTraces()).toHaveLength(0);
        expect(ledger.getInfrastructure()).toHaveLength(0);
        expect(ledger.getDatabase()).toHaveLength(0);
        expect(ledger.exportSummary()).toBe("Nenhuma evidência técnica registrada até o momento.");
    });

    it('deve acumular logs e indicar que possui evidências', () => {
        ledger.addLog({
            level: 'error',
            message: 'NullPointerException no endpoint /checkout',
            source: 'payment-service',
            timestamp: '2026-09-09T12:00:00Z',
        });

        expect(ledger.hasEvidence()).toBe(true);
        expect(ledger.getLogs()).toHaveLength(1);
        expect(ledger.getLogs()[0].message).toContain('NullPointerException');

        const summary = ledger.exportSummary();
        expect(summary).toContain('### Logs Relevantes:');
        expect(summary).toContain('[ERROR] NullPointerException no endpoint /checkout (payment-service)');
    });

    it('deve acumular métricas, traces, infraestrutura e dados de banco', () => {
        ledger.addMetric({
            query: 'http_requests_total{status=~"5.."}',
            value: 142,
            unit: 'req/s',
            description: 'Taxa de erros HTTP 5xx',
        });

        ledger.addTrace({
            traceId: 'trace-abc-123',
            operationName: 'POST /checkout',
            serviceName: 'checkout-api',
            durationMs: 4500,
            error: true,
        });

        ledger.addInfrastructure({
            component: 'pod/payment-svc-789bf',
            status: 'CrashLoopBackOff',
            restartCount: 5,
            details: 'Back-off restarting failed container',
        });

        ledger.addDatabase({
            metricOrQuery: 'active_connections',
            value: 100,
            poolUtilization: 1.0,
            slowQuery: true,
        });

        expect(ledger.getMetrics()).toHaveLength(1);
        expect(ledger.getTraces()).toHaveLength(1);
        expect(ledger.getInfrastructure()).toHaveLength(1);
        expect(ledger.getDatabase()).toHaveLength(1);

        const summary = ledger.exportSummary();
        expect(summary).toContain('### Métricas Observadas:');
        expect(summary).toContain('Taxa de erros HTTP 5xx: 142 req/s');
        expect(summary).toContain('### Traces & Gargalos:');
        expect(summary).toContain('[Trace trace-abc-123] POST /checkout (checkout-api) durou 4500ms [ERRO]');
        expect(summary).toContain('### Infraestrutura & Kubernetes:');
        expect(summary).toContain('[Infra: pod/payment-svc-789bf] Status: CrashLoopBackOff (Restarts: 5)');
        expect(summary).toContain('### Banco de Dados & Conexões:');
        expect(summary).toContain('[Banco] active_connections: 100 (Uso pool: 100.0%) [SLOW QUERY]');
    });

    it('deve limpar todas as evidências com clear()', () => {
        ledger.addLog({ message: 'Erro temporário' });
        ledger.addMetric({ query: 'cpu', value: 95 });

        expect(ledger.hasEvidence()).toBe(true);
        ledger.clear();

        expect(ledger.hasEvidence()).toBe(false);
        expect(ledger.getLogs()).toHaveLength(0);
        expect(ledger.getMetrics()).toHaveLength(0);
    });
});
