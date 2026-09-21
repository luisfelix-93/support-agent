import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionTimeoutSweeper } from './SessionTimeoutSweeper.js';
import { InvestigationSession } from '../domain/InvestigationSession.js';
import { SessionStatus } from '../domain/SessionStatus.js';
import { SessionSummary } from '../domain/workflows/SessionSummary.js';
import type { ISessionRepository } from '../domain/ports/ISessionRepository.js';
import type { ChatProviderFactory } from '../infrastructure/chat/ChatProviderFactory.js';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';

describe('SessionTimeoutSweeper', () => {
    let mockSessionRepo: ISessionRepository;
    let mockChatProviderFactory: ChatProviderFactory;
    let mockChatRepo: IChatRepository;
    let mockChatProvider: any;
    let sweeper: SessionTimeoutSweeper;

    const baseDate = new Date('2026-09-18T12:00:00.000Z');

    const createExistingSummary = () =>
        new SessionSummary({
            runId: 'run-existing',
            serviceName: 'checkout-api',
            incidentWindow: { start: '10:00', end: '10:30' },
            rootCauseHypothesis: 'Falha no pod k8s',
            evidence: { logs: ['OOMKilled'], metrics: [] },
            recommendedActions: ['Aumentar limite de memória'],
        });

    beforeEach(() => {
        vi.clearAllMocks();

        mockChatProvider = {
            sendMessage: vi.fn().mockResolvedValue(undefined),
        };

        mockChatProviderFactory = {
            getProvider: vi.fn().mockResolvedValue(mockChatProvider),
        } as any;

        mockChatRepo = {
            findById: vi.fn().mockResolvedValue({
                addMessage: vi.fn(),
            }),
            save: vi.fn().mockResolvedValue(undefined),
        } as any;

        mockSessionRepo = {
            save: vi.fn().mockResolvedValue(undefined),
            findById: vi.fn().mockResolvedValue(null),
            findActiveByThreadId: vi.fn().mockResolvedValue(null),
            findInactiveSessions: vi.fn().mockResolvedValue([]),
            createIndexes: vi.fn().mockResolvedValue(undefined),
        };

        sweeper = new SessionTimeoutSweeper(
            mockSessionRepo,
            mockChatProviderFactory,
            mockChatRepo
        );
    });

    it('deve retornar resultado vazio quando não houver sessões inativas', async () => {
        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 0,
            expired: 0,
            warned: 0,
            errors: 0,
        });
        expect(mockSessionRepo.save).not.toHaveBeenCalled();
        expect(mockChatProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('deve expirar sessão inativa com SessionSummary já existente e notificar chat', async () => {
        const expiredSession = new InvestigationSession({
            id: 'sess-1',
            workspaceId: 'ws-acme',
            threadId: 'th-1',
            status: SessionStatus.AWAITING_CLOSURE_CONFIRMATION,
            startedAt: new Date('2026-09-18T10:00:00.000Z'),
            lastInteractionAt: new Date('2026-09-18T10:30:00.000Z'), // 1h30 atrás
            idleTimeoutMs: 1800000, // 30 min
            sessionSummary: createExistingSummary(),
            metadata: { source: 'slack' },
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([expiredSession]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 1,
            expired: 1,
            warned: 0,
            errors: 0,
        });

        expect(expiredSession.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
        expect(expiredSession.isClosed()).toBe(true);
        expect(expiredSession.closedAt).toEqual(baseDate);
        expect(mockSessionRepo.save).toHaveBeenCalledWith(expiredSession);

        expect(mockChatProviderFactory.getProvider).toHaveBeenCalledWith('ws-acme', 'slack');
        expect(mockChatProvider.sendMessage).toHaveBeenCalledWith(
            'th-1',
            expect.stringContaining('Sessão de investigação encerrada automaticamente por inatividade.')
        );
        expect(mockChatRepo.save).toHaveBeenCalled();
    });

    it('deve compilar SessionSummary automaticamente a partir do EvidenceLedger se a sessão não possuir resumo', async () => {
        const expiredSession = new InvestigationSession({
            id: 'sess-2',
            workspaceId: 'ws-acme',
            threadId: 'th-2',
            status: SessionStatus.ACTIVE,
            startedAt: new Date('2026-09-18T10:00:00.000Z'),
            lastInteractionAt: new Date('2026-09-18T10:45:00.000Z'), // 1h15 atrás
            idleTimeoutMs: 1800000, // 30 min
        });
        expiredSession.evidenceLedger.addLog({ message: 'Conexão recusada pela porta 5432' });
        expiredSession.evidenceLedger.addMetric({ query: 'db_errors_total', value: 42 });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([expiredSession]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result.expired).toBe(1);
        expect(expiredSession.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
        expect(expiredSession.sessionSummary).not.toBeNull();
        expect(expiredSession.sessionSummary?.evidence.logs).toContain('Conexão recusada pela porta 5432');
        expect(expiredSession.sessionSummary?.evidence.metrics).toContain('db_errors_total: 42');
        expect(mockSessionRepo.save).toHaveBeenCalledWith(expiredSession);
    });

    it('deve enviar aviso de inatividade de 15 minutos e propor encerramento da sessão', async () => {
        const idleWarningSession = new InvestigationSession({
            id: 'sess-warn',
            workspaceId: 'ws-acme',
            threadId: 'th-warn',
            status: SessionStatus.ACTIVE,
            startedAt: new Date('2026-09-18T11:00:00.000Z'),
            lastInteractionAt: new Date('2026-09-18T11:45:00.000Z'), // exatamente 15 min atrás
            idleTimeoutMs: 1800000, // 30 min
            warningTimeoutMs: 900000, // 15 min
            metadata: { source: 'slack' },
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([idleWarningSession]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 1,
            expired: 0,
            warned: 1,
            errors: 0,
        });

        expect(idleWarningSession.status).toBe(SessionStatus.AWAITING_CLOSURE_CONFIRMATION);
        expect(idleWarningSession.metadata.closureWarningSentAt).toBe(baseDate.toISOString());
        expect(mockSessionRepo.save).toHaveBeenCalledWith(idleWarningSession);
        expect(mockChatProvider.sendMessage).toHaveBeenCalledWith(
            'th-warn',
            expect.stringContaining('Não identifiquei novas mensagens nesta thread nos últimos 15 minutos')
        );
    });

    it('não deve reenviar o aviso de 15 minutos se o aviso já foi registrado após a última interação', async () => {
        const warnedSession = new InvestigationSession({
            id: 'sess-warned',
            workspaceId: 'ws-acme',
            threadId: 'th-warned',
            status: SessionStatus.AWAITING_CLOSURE_CONFIRMATION,
            lastInteractionAt: new Date('2026-09-18T11:45:00.000Z'),
            idleTimeoutMs: 1800000,
            warningTimeoutMs: 900000,
            metadata: {
                source: 'slack',
                closureWarningSentAt: new Date('2026-09-18T11:50:00.000Z').toISOString(),
            },
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([warnedSession]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 1,
            expired: 0,
            warned: 0,
            errors: 0,
        });
        expect(mockChatProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('não deve expirar nem avisar sessões cujo tempo de inatividade seja inferior a 15 minutos', async () => {
        const stillActiveSession = new InvestigationSession({
            id: 'sess-3',
            workspaceId: 'ws-acme',
            threadId: 'th-3',
            status: SessionStatus.ACTIVE,
            startedAt: new Date('2026-09-18T11:00:00.000Z'),
            lastInteractionAt: new Date('2026-09-18T11:55:00.000Z'), // apenas 5 min atrás
            idleTimeoutMs: 1800000, // 30 min
            warningTimeoutMs: 900000, // 15 min
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([stillActiveSession]);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 1,
            expired: 0,
            warned: 0,
            errors: 0,
        });
        expect(stillActiveSession.status).toBe(SessionStatus.ACTIVE);
        expect(mockSessionRepo.save).not.toHaveBeenCalled();
    });

    it('deve tolerar falha no envio de mensagem para o chat sem interromper o lote', async () => {
        const sessionFail = new InvestigationSession({
            id: 'sess-fail',
            workspaceId: 'ws-1',
            threadId: 'th-fail',
            status: SessionStatus.ACTIVE,
            lastInteractionAt: new Date('2026-09-18T10:00:00.000Z'),
            idleTimeoutMs: 3600000,
        });

        const sessionOk = new InvestigationSession({
            id: 'sess-ok',
            workspaceId: 'ws-2',
            threadId: 'th-ok',
            status: SessionStatus.ACTIVE,
            lastInteractionAt: new Date('2026-09-18T10:00:00.000Z'),
            idleTimeoutMs: 3600000,
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([sessionFail, sessionOk]);
        vi.mocked(mockChatProvider.sendMessage)
            .mockRejectedValueOnce(new Error('Slack API timeout'))
            .mockResolvedValueOnce(undefined);

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result.scanned).toBe(2);
        expect(result.expired).toBe(2);
        expect(result.warned).toBe(0);
        expect(result.errors).toBe(0); // Tratamento de notificação resiliente não cancela o encerramento
        expect(sessionFail.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
        expect(sessionOk.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
    });

    it('deve registrar erro no resultado se o salvamento no repositório falhar', async () => {
        const session = new InvestigationSession({
            id: 'sess-err',
            workspaceId: 'ws-1',
            threadId: 'th-err',
            status: SessionStatus.ACTIVE,
            lastInteractionAt: new Date('2026-09-18T10:00:00.000Z'),
            idleTimeoutMs: 3600000,
        });

        vi.mocked(mockSessionRepo.findInactiveSessions).mockResolvedValue([session]);
        vi.mocked(mockSessionRepo.save).mockRejectedValue(new Error('Mongo connection lost'));

        const result = await sweeper.sweepExpiredSessions(baseDate);

        expect(result).toEqual({
            scanned: 1,
            expired: 0,
            warned: 0,
            errors: 1,
        });
    });
});
