import { describe, it, expect } from 'vitest';
import { SessionSummary } from './SessionSummary.js';

describe('SessionSummary', () => {
    it('deve instanciar com sucesso quando todos os campos obrigatórios forem fornecidos', () => {
        const summary = new SessionSummary({
            runId: 'run-12345',
            serviceName: 'order-api',
            incidentWindow: { start: '14:00', end: '14:25' },
            rootCauseHypothesis: 'Esgotamento do pool de conexões do Postgres devido a slow query.',
            evidence: {
                logs: ['Timeout waiting for connection from pool'],
                metrics: ['Active connections = 100/100'],
                traces: ['Span db.query durou 30s'],
            },
            recommendedActions: [
                'Aumentar max_connections temporariamente',
                'Adicionar índice na coluna order_id',
            ],
            playbooksInvolved: ['api-error', 'database'],
        });

        expect(summary.runId).toBe('run-12345');
        expect(summary.serviceName).toBe('order-api');
        expect(summary.rootCauseHypothesis).toBe('Esgotamento do pool de conexões do Postgres devido a slow query.');
        expect(summary.evidence.logs).toHaveLength(1);
        expect(summary.recommendedActions).toHaveLength(2);
        expect(summary.playbooksInvolved).toEqual(['api-error', 'database']);
    });

    it('deve lançar erro se runId estiver vazio', () => {
        expect(() => {
            new SessionSummary({
                runId: '',
                serviceName: 'order-api',
                rootCauseHypothesis: 'Falha qualquer',
                evidence: { logs: [], metrics: [] },
                recommendedActions: ['Reiniciar pod'],
            });
        }).toThrow('O campo runId é obrigatório para o SessionSummary.');
    });

    it('deve lançar erro se rootCauseHypothesis estiver vazia', () => {
        expect(() => {
            new SessionSummary({
                runId: 'run-1',
                serviceName: 'order-api',
                rootCauseHypothesis: '   ',
                evidence: { logs: [], metrics: [] },
                recommendedActions: ['Reiniciar pod'],
            });
        }).toThrow('A hipótese de causa raiz (rootCauseHypothesis) é obrigatória.');
    });

    it('deve lançar erro se recommendedActions for vazia', () => {
        expect(() => {
            new SessionSummary({
                runId: 'run-1',
                serviceName: 'order-api',
                rootCauseHypothesis: 'Falha identificada',
                evidence: { logs: [], metrics: [] },
                recommendedActions: [],
            });
        }).toThrow('O SessionSummary deve conter ao menos uma ação recomendada.');
    });

    it('deve formatar corretamente o Markdown com toMarkdown()', () => {
        const summary = new SessionSummary({
            runId: 'run-abc-999',
            serviceName: 'payment-gateway',
            incidentWindow: { start: '10:00:00' },
            rootCauseHypothesis: 'Certificado mTLS expirado na comunicação com adquirente.',
            evidence: {
                logs: ['SSL handshake failed: certificate expired'],
                metrics: ['502 Bad Gateway spike: 100%'],
                traces: ['Span external_call returned error'],
            },
            recommendedActions: ['Renovar certificado no secret do Kubernetes'],
            playbooksInvolved: ['api-error'],
        });

        const md = summary.toMarkdown();
        expect(md).toContain('📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)');
        expect(md).toContain('• Run ID: run-abc-999');
        expect(md).toContain('• Serviço / Componente: payment-gateway');
        expect(md).toContain('• Janela do Incidente: 10:00:00 até Em andamento');
        expect(md).toContain('• Playbooks Ativados: api-error');
        expect(md).toContain('SSL handshake failed: certificate expired');
        expect(md).toContain('502 Bad Gateway spike: 100%');
        expect(md).toContain('Span external_call returned error');
        expect(md).toContain('💡 HIPÓTESE DE CAUSA RAIZ (RCA):');
        expect(md).toContain('Certificado mTLS expirado na comunicação com adquirente.');
        expect(md).toContain('1. Renovar certificado no secret do Kubernetes');
    });
});
