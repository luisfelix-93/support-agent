import { describe, it, expect } from 'vitest';
import { InvestigationSession } from './InvestigationSession.js';
import { SessionStatus } from './SessionStatus.js';
import { EvidenceLedger } from './workflows/EvidenceLedger.js';
import { SessionSummary } from './workflows/SessionSummary.js';

describe('InvestigationSession', () => {
    const defaultProps = {
        id: 'sess-123',
        workspaceId: 'ws-prod',
        threadId: 'th-abc',
        channelId: 'chan-alerts',
    };

    const createMockSummary = (runId = 'run-1') =>
        new SessionSummary({
            runId,
            serviceName: 'order-service',
            rootCauseHypothesis: 'Pool de conexões exaurido',
            evidence: {
                logs: ['Connection timeout'],
                metrics: ['pool_utilization = 1.0'],
            },
            recommendedActions: ['Reiniciar instâncias com pool expandido'],
        });

    describe('Instanciação e Valores Padrão', () => {
        it('deve instanciar uma sessão com valores padrão consistentes', () => {
            const session = new InvestigationSession(defaultProps);

            expect(session.id).toBe('sess-123');
            expect(session.workspaceId).toBe('ws-prod');
            expect(session.threadId).toBe('th-abc');
            expect(session.channelId).toBe('chan-alerts');
            expect(session.status).toBe(SessionStatus.ACTIVE);
            expect(session.idleTimeoutMs).toBe(3600000); // 1 hora padrão
            expect(session.isClosed()).toBe(false);
            expect(session.startedAt).toBeInstanceOf(Date);
            expect(session.lastInteractionAt).toBeInstanceOf(Date);
            expect(session.closedAt).toBeNull();
            expect(session.sessionSummary).toBeNull();
            expect(session.evidenceLedger).toBeInstanceOf(EvidenceLedger);
            expect(session.metadata).toEqual({});
        });

        it('deve permitir configurar idleTimeoutMs customizado', () => {
            const session = new InvestigationSession({
                ...defaultProps,
                idleTimeoutMs: 1800000, // 30 min
            });

            expect(session.idleTimeoutMs).toBe(1800000);
        });

        it('deve lançar erro se id, workspaceId ou threadId forem vazios', () => {
            expect(() => new InvestigationSession({ ...defaultProps, id: '' }))
                .toThrow('O identificador (id) da sessão é obrigatório.');
            expect(() => new InvestigationSession({ ...defaultProps, workspaceId: '   ' }))
                .toThrow('O workspaceId da sessão é obrigatório.');
            expect(() => new InvestigationSession({ ...defaultProps, threadId: '' }))
                .toThrow('O threadId da sessão é obrigatório.');
        });

        it('deve lançar erro se idleTimeoutMs for menor ou igual a zero', () => {
            expect(() => new InvestigationSession({ ...defaultProps, idleTimeoutMs: 0 }))
                .toThrow('idleTimeoutMs deve ser maior que zero.');
            expect(() => new InvestigationSession({ ...defaultProps, idleTimeoutMs: -500 }))
                .toThrow('idleTimeoutMs deve ser maior que zero.');
        });
    });

    describe('Transições de Estado e Interações', () => {
        it('deve atualizar lastInteractionAt com touch()', () => {
            const initialDate = new Date(Date.now() - 10000);
            const session = new InvestigationSession({
                ...defaultProps,
                lastInteractionAt: initialDate,
            });

            const newInteractionTime = new Date();
            session.touch(newInteractionTime);

            expect(session.lastInteractionAt.getTime()).toBe(newInteractionTime.getTime());
        });

        it('deve transitar para AWAITING_CLOSURE_CONFIRMATION com proposeClosure()', () => {
            const session = new InvestigationSession(defaultProps);
            expect(session.status).toBe(SessionStatus.ACTIVE);

            session.proposeClosure();

            expect(session.status).toBe(SessionStatus.AWAITING_CLOSURE_CONFIRMATION);
            expect(session.isClosed()).toBe(false);
        });

        it('deve reverter de AWAITING_CLOSURE_CONFIRMATION para ACTIVE com cancelClosureProposal()', () => {
            const session = new InvestigationSession(defaultProps);
            session.proposeClosure();
            expect(session.status).toBe(SessionStatus.AWAITING_CLOSURE_CONFIRMATION);

            session.cancelClosureProposal();

            expect(session.status).toBe(SessionStatus.ACTIVE);
        });

        it('deve encerrar por confirmação do usuário com confirmClosure()', () => {
            const session = new InvestigationSession(defaultProps);
            const summary = createMockSummary();
            const closedAt = new Date();

            session.confirmClosure(summary, closedAt);

            expect(session.status).toBe(SessionStatus.CLOSED_BY_USER);
            expect(session.isClosed()).toBe(true);
            expect(session.closedAt?.getTime()).toBe(closedAt.getTime());
            expect(session.sessionSummary).toBe(summary);
        });

        it('deve encerrar por timeout com expireByTimeout()', () => {
            const session = new InvestigationSession(defaultProps);
            const summary = createMockSummary();
            const closedAt = new Date();

            session.expireByTimeout(summary, closedAt);

            expect(session.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
            expect(session.isClosed()).toBe(true);
            expect(session.closedAt?.getTime()).toBe(closedAt.getTime());
            expect(session.sessionSummary).toBe(summary);
        });

        it('não deve permitir touch() em sessão já encerrada', () => {
            const session = new InvestigationSession(defaultProps);
            session.confirmClosure();

            expect(() => session.touch()).toThrow('Não é possível interagir com uma sessão encerrada.');
        });

        it('não deve permitir proposeClosure() em sessão já encerrada', () => {
            const session = new InvestigationSession(defaultProps);
            session.expireByTimeout();

            expect(() => session.proposeClosure()).toThrow('Sessão já está encerrada.');
        });

        it('não deve permitir re-encerrar uma sessão já encerrada', () => {
            const session = new InvestigationSession(defaultProps);
            session.confirmClosure();

            expect(() => session.confirmClosure()).toThrow('Sessão já foi encerrada anteriormente.');
            expect(() => session.expireByTimeout()).toThrow('Sessão já foi encerrada anteriormente.');
        });
    });

    describe('Detecção de Expiração por Inatividade (isExpired)', () => {
        it('deve retornar false quando o tempo de inatividade for inferior ao timeout', () => {
            const now = new Date('2026-09-18T12:00:00.000Z');
            const session = new InvestigationSession({
                ...defaultProps,
                idleTimeoutMs: 3600000, // 1h
                lastInteractionAt: new Date('2026-09-18T11:30:00.000Z'), // 30 min atrás
            });

            expect(session.isExpired(now)).toBe(false);
        });

        it('deve retornar true quando o tempo de inatividade atingir ou ultrapassar o timeout', () => {
            const now = new Date('2026-09-18T12:00:00.000Z');
            const session = new InvestigationSession({
                ...defaultProps,
                idleTimeoutMs: 3600000, // 1h
                lastInteractionAt: new Date('2026-09-18T11:00:00.000Z'), // Exatamente 1h atrás
            });

            expect(session.isExpired(now)).toBe(true);

            const later = new Date('2026-09-18T12:15:00.000Z'); // 1h15 atrás
            expect(session.isExpired(later)).toBe(true);
        });

        it('deve retornar false para isExpired se a sessão já estiver encerrada', () => {
            const now = new Date('2026-09-18T14:00:00.000Z');
            const session = new InvestigationSession({
                ...defaultProps,
                idleTimeoutMs: 3600000,
                lastInteractionAt: new Date('2026-09-18T11:00:00.000Z'),
            });
            session.confirmClosure();

            expect(session.isExpired(now)).toBe(false);
        });
    });

    describe('Acoplamento com EvidenceLedger e SessionSummary', () => {
        it('deve acumular evidências no EvidenceLedger interno', () => {
            const session = new InvestigationSession(defaultProps);

            session.evidenceLedger.addLog({ message: 'Error 500 in /checkout' });
            session.evidenceLedger.addMetric({ query: 'error_rate', value: 0.15 });

            expect(session.evidenceLedger.getLogs()).toHaveLength(1);
            expect(session.evidenceLedger.getMetrics()).toHaveLength(1);
        });

        it('deve permitir definir sessionSummary via setSessionSummary()', () => {
            const session = new InvestigationSession(defaultProps);
            const summary = createMockSummary();

            session.setSessionSummary(summary);
            expect(session.sessionSummary).toBe(summary);
        });

        it('não deve permitir setSessionSummary() se sessão estiver fechada', () => {
            const session = new InvestigationSession(defaultProps);
            session.confirmClosure();

            expect(() => session.setSessionSummary(createMockSummary()))
                .toThrow('Não é possível modificar o resumo de uma sessão já encerrada.');
        });
    });
});
