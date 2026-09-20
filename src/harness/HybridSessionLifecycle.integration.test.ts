import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { ProcessAgentResponseUse } from '../usecases/ProcessAgentResponseUseCase.js';
import { SessionTimeoutSweeper } from '../services/SessionTimeoutSweeper.js';
import { SessionTimeoutWorker } from '../infrastructure/queue/SessionTimeoutWorker.js';
import { SpaceMapping } from '../domain/SpaceMapping.js';
import { Tenant } from '../domain/Tenant.js';
import { ChatContext } from '../domain/ChatContext.js';
import { SessionStatus } from '../domain/SessionStatus.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { ApiErrorPlaybook } from '../domain/workflows/playbooks/ApiErrorPlaybook.js';
import { DatabasePlaybook } from '../domain/workflows/playbooks/DatabasePlaybook.js';
import type { ISpaceMappingRepository } from '../domain/ports/ISpaceMappingRepository.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';
import type { ISessionRepository } from '../domain/ports/ISessionRepository.js';
import type { IChatProvider } from '../domain/ports/IChatProvider.js';
import type { ChatProviderFactory } from '../infrastructure/chat/ChatProviderFactory.js';
import type { InvestigationSession } from '../domain/InvestigationSession.js';

// Mock do LLMFactory e MCPHttpAdapter para evitar conexões de rede no teste
vi.mock('../infrastructure/llm/LLMFactory.js', () => ({
    LLMFactory: {
        create: vi.fn().mockReturnValue({
            generateResponse: vi.fn(),
            generateText: vi.fn(),
        }),
    },
}));

const mockMCPInstance = {
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    executeTool: vi.fn().mockResolvedValue({ result: 'ok' }),
    close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../infrastructure/mcp/MCPHttpAdapter.js', () => ({
    MCPHttpAdapter: vi.fn().mockImplementation(function () {
        return mockMCPInstance;
    }),
}));


describe('Hybrid Session Lifecycle E2E Integration Test', () => {
    let spaceMappingRepo: ISpaceMappingRepository;
    let tenantRepo: ITenantRepository;
    let chatRepo: IChatRepository;
    let sessionRepo: ISessionRepository;
    let chatProvider: IChatProvider;
    let chatProviderFactory: ChatProviderFactory;
    let investigationEngine: InvestigationEngine;

    // Repositório in-memory simulado para sessões
    const sessionsStore = new Map<string, InvestigationSession>();

    const fakeMapping = new SpaceMapping('spaces/OPS_SPACE', 'workspace-prod');
    const fakeTenant = new Tenant(
        'workspace-prod',
        { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
        { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
        true
    );

    beforeEach(() => {
        sessionsStore.clear();
        vi.clearAllMocks();

        spaceMappingRepo = {
            findBySpaceId: vi.fn().mockResolvedValue(fakeMapping),
            save: vi.fn().mockResolvedValue(undefined),
        };

        tenantRepo = {
            findByWorkspaceId: vi.fn().mockResolvedValue(fakeTenant),
            save: vi.fn().mockResolvedValue(undefined),
        };

        const chatContexts = new Map<string, ChatContext>();
        chatRepo = {
            findById: vi.fn().mockImplementation(async (threadId: string, workspaceId: string) => {
                const key = `${workspaceId}:${threadId}`;
                if (!chatContexts.has(key)) {
                    chatContexts.set(key, new ChatContext(threadId, workspaceId));
                }
                return chatContexts.get(key)!;
            }),
            save: vi.fn().mockResolvedValue(undefined),
        };

        chatProvider = {
            sendMessage: vi.fn().mockResolvedValue(undefined),
        };

        chatProviderFactory = {
            getProvider: vi.fn().mockResolvedValue(chatProvider),
        } as any;

        sessionRepo = {
            createIndexes: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockImplementation(async (session: InvestigationSession) => {
                sessionsStore.set(session.id, session);
            }),
            findById: vi.fn().mockImplementation(async (id: string) => {
                return sessionsStore.get(id) ?? null;
            }),
            findActiveByThreadId: vi.fn().mockImplementation(async (threadId: string, workspaceId: string) => {
                for (const sess of sessionsStore.values()) {
                    if (
                        sess.threadId === threadId &&
                        sess.workspaceId === workspaceId &&
                        (sess.status === SessionStatus.ACTIVE || sess.status === SessionStatus.AWAITING_CLOSURE_CONFIRMATION)
                    ) {
                        return sess;
                    }
                }
                return null;
            }),
            findInactiveSessions: vi.fn().mockImplementation(async (cutoffDate: Date, limit: number = 50) => {
                const results: InvestigationSession[] = [];
                for (const sess of sessionsStore.values()) {
                    if (
                        (sess.status === SessionStatus.ACTIVE || sess.status === SessionStatus.AWAITING_CLOSURE_CONFIRMATION) &&
                        sess.lastInteractionAt.getTime() <= cutoffDate.getTime()
                    ) {
                        results.push(sess);
                        if (results.length >= limit) break;
                    }
                }
                return results;
            }),
        };

        const playbookRegistry = new PlaybookRegistry();
        playbookRegistry.register(new ApiErrorPlaybook());
        playbookRegistry.register(new DatabasePlaybook());
        investigationEngine = new InvestigationEngine(playbookRegistry);
    });

    it('Cenário 1: Fechamento Conversacional Ativo (Início -> Investigação com Summary -> Confirmação -> Fechado por Usuário)', async () => {
        const threadId = 'thread-active-flow';
        const spaceId = 'spaces/OPS_SPACE';

        const summaryMarkdown = `A análise técnica foi concluída com sucesso.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-incident-100
• Serviço / Componente: payments-api
• Janela do Incidente: 10:15 - 10:45
• Playbooks Ativados: api-error

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - Error 500: Database connection pool timeout
• Métricas:
  - db_pool_exhausted: 1.0

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
O pool de conexões do banco de dados esgotou após pico inesperado de chamadas.

🛠️ AÇÕES RECOMENDADAS:
1. Reiniciar os pods para limpar conexões zumbis.
2. Aumentar o pool_size para 50.
═══════════════════════════════════════════════════════════`;

        const mockHarness = {
            run: vi.fn().mockResolvedValue({
                runId: 'run-incident-100',
                response: summaryMarkdown,
                iterations: 2,
                toolCalls: [],
                status: 'completed',
                durationMs: 120,
            }),
        };

        const useCase = new ProcessAgentResponseUse(
            spaceMappingRepo,
            tenantRepo,
            chatRepo,
            mockHarness as any,
            investigationEngine,
            undefined,
            sessionRepo
        );

        // Mensagem 1: Operador relata o incidente
        await useCase.execute(spaceId, threadId, 'A payments-api está caindo com erro 500', chatProvider);

        // Verificações da Mensagem 1:
        // 1. Uma sessão foi criada e vinculada
        expect(sessionsStore.size).toBe(1);
        const activeSession = Array.from(sessionsStore.values())[0];
        expect(activeSession.threadId).toBe(threadId);
        expect(activeSession.workspaceId).toBe('workspace-prod');

        // 2. Como o harness devolveu o bloco de resumo, a sessão transita para AWAITING_CLOSURE_CONFIRMATION
        expect(activeSession.status).toBe(SessionStatus.AWAITING_CLOSURE_CONFIRMATION);
        expect(activeSession.sessionSummary).not.toBeNull();
        expect(activeSession.sessionSummary?.serviceName).toBe('payments-api');

        // 3. O bot respondeu anexando o convite interativo de encerramento (sem vazar o resumo no chat durante o fluxo)
        expect(chatProvider.sendMessage).toHaveBeenCalledWith(
            threadId,
            expect.stringContaining('Deseja encerrar esta sessão de investigação?')
        );
        expect(chatProvider.sendMessage).not.toHaveBeenCalledWith(
            threadId,
            expect.stringContaining('📋 RESUMO EXECUTIVO DE SESSÃO')
        );

        // Mensagem 2: Operador confirma o encerramento ("Sim, resolvido, pode encerrar")
        await useCase.execute(spaceId, threadId, 'Sim, o problema foi resolvido, pode encerrar!', chatProvider);

        // Verificações da Mensagem 2:
        // 1. A sessão transita para CLOSED_BY_USER e closedAt é preenchido
        expect(activeSession.status).toBe(SessionStatus.CLOSED_BY_USER);
        expect(activeSession.isClosed()).toBe(true);
        expect(activeSession.closedAt).toBeInstanceOf(Date);

        // 2. Não chamou o LLM novamente (economia de tokens)
        expect(mockHarness.run).toHaveBeenCalledTimes(1);

        // 3. Enviou mensagem final conclusiva no chat contendo o resumo executivo exclusivamente após o encerramento
        expect(chatProvider.sendMessage).toHaveBeenLastCalledWith(
            threadId,
            expect.stringContaining('Sessão de investigação encerrada com sucesso.')
        );
        expect(chatProvider.sendMessage).toHaveBeenLastCalledWith(
            threadId,
            expect.stringContaining('📋 RESUMO EXECUTIVO DE SESSÃO')
        );
    });

    it('Cenário 2: Fechamento Automático por Inatividade (Início -> Abandono -> Sweeper após 1h -> Fechado por Timeout)', async () => {
        const threadId = 'thread-timeout-flow';
        const spaceId = 'spaces/OPS_SPACE';

        const mockHarness = {
            run: vi.fn().mockResolvedValue({
                runId: 'run-incident-200',
                response: 'Análise preliminar: observamos oscilação na porta do banco. Aguardando mais dados.',
                iterations: 1,
                toolCalls: [],
                status: 'completed',
                durationMs: 40,
            }),
        };

        const useCase = new ProcessAgentResponseUse(
            spaceMappingRepo,
            tenantRepo,
            chatRepo,
            mockHarness as any,
            investigationEngine,
            undefined,
            sessionRepo
        );

        const startTime = new Date('2026-09-18T10:00:00.000Z');
        vi.setSystemTime(startTime);

        // Mensagem 1: Operador inicia a análise
        await useCase.execute(spaceId, threadId, 'Verifique se há lentidão no banco postgres', chatProvider);

        expect(sessionsStore.size).toBe(1);
        const session = Array.from(sessionsStore.values())[0];
        expect(session.status).toBe(SessionStatus.ACTIVE);
        expect(session.isClosed()).toBe(false);

        // Simula coleta de evidências adicionais no ledger da sessão
        session.evidenceLedger.addLog({ message: 'PostgreSQL: deadlock detected on process 1402' });
        session.evidenceLedger.addDatabase({ metricOrQuery: 'locks_waiting', value: 5 });
        await sessionRepo.save(session);

        // O operador não responde mais. O tempo avança 1 hora e 15 minutos (75 minutos)
        const laterTime = new Date('2026-09-18T11:15:00.000Z');
        vi.setSystemTime(laterTime);

        // Instancia o Sweeper e o Worker
        const sweeper = new SessionTimeoutSweeper(sessionRepo, chatProviderFactory, chatRepo);
        const worker = new SessionTimeoutWorker(sweeper, 60000);

        // Executa varredura manual de expiração
        const sweepResult = await worker.triggerNow();

        expect(sweepResult.scanned).toBe(1);
        expect(sweepResult.expired).toBe(1);
        expect(sweepResult.errors).toBe(0);

        // Verificações do encerramento por timeout:
        // 1. Status atualizado para CLOSED_BY_TIMEOUT
        expect(session.status).toBe(SessionStatus.CLOSED_BY_TIMEOUT);
        expect(session.isClosed()).toBe(true);
        expect(session.closedAt).toEqual(laterTime);

        // 2. Resumo sintetizado automaticamente a partir do EvidenceLedger
        expect(session.sessionSummary).not.toBeNull();
        expect(session.sessionSummary?.evidence.logs).toContain('PostgreSQL: deadlock detected on process 1402');

        // 3. Notificação enviada na thread informando o encerramento automático
        expect(chatProvider.sendMessage).toHaveBeenCalledWith(
            threadId,
            expect.stringContaining('Sessão de investigação encerrada automaticamente por inatividade.')
        );

        vi.useRealTimers();
    });
});
