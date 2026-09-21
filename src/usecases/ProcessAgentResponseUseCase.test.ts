import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessAgentResponseUse } from './ProcessAgentResponseUseCase.js';
import type { ISpaceMappingRepository } from '../domain/ports/ISpaceMappingRepository.js';
import type { ITenantRepository } from '../domain/ports/ITenantRepository.js';
import type { IChatRepository } from '../domain/ports/IChatRepository.js';
import type { IChatProvider } from '../domain/ports/IChatProvider.js';
import { SpaceMapping } from '../domain/SpaceMapping.js';
import { Tenant } from '../domain/Tenant.js';
import { ChatContext } from '../domain/ChatContext.js';
import { AgentHarness } from '../harness/AgentHarness.js';
import { ContextAssembler } from '../harness/ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';

// Mock do LLMFactory para não instanciar adaptadores reais
vi.mock('../infrastructure/llm/LLMFactory.js', () => ({
    LLMFactory: {
        create: vi.fn(),
    },
}));

const mockMCPHttpAdapterInstance = {
    isConnected: vi.fn().mockReturnValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    executeTool: vi.fn().mockResolvedValue({ result: 'tool-output' }),
    close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../infrastructure/mcp/MCPHttpAdapter.js', () => ({
    MCPHttpAdapter: vi.fn().mockImplementation(function () {
        return mockMCPHttpAdapterInstance;
    }),
}));

import { LLMFactory } from '../infrastructure/llm/LLMFactory.js';

function makeSpaceMappingRepo(overrides: Partial<ISpaceMappingRepository> = {}): ISpaceMappingRepository {
    return {
        findBySpaceId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeTenantRepo(overrides: Partial<ITenantRepository> = {}): ITenantRepository {
    return {
        findByWorkspaceId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeChatRepo(overrides: Partial<IChatRepository> = {}): IChatRepository {
    return {
        findById: vi.fn().mockResolvedValue(new ChatContext('thread-1', 'workspace-abc')),
        save: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeChatProvider(overrides: Partial<IChatProvider> = {}): IChatProvider {
    return {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

const fakeMapping = new SpaceMapping('spaces/AAAA1111', 'workspace-abc');
const fakeTenant = new Tenant(
    'workspace-abc',
    { provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' },
    { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
    true
);

describe('ProcessAgentResponseUseCase', () => {
    let spaceMappingRepo: ISpaceMappingRepository;
    let tenantRepo: ITenantRepository;
    let chatRepo: IChatRepository;
    let chatProvider: IChatProvider;
    let harness: AgentHarness;
    let useCase: ProcessAgentResponseUse;

    beforeEach(() => {
        vi.clearAllMocks();
        mockMCPHttpAdapterInstance.executeTool.mockReset().mockResolvedValue({ result: 'tool-output' });

        spaceMappingRepo = makeSpaceMappingRepo({ findBySpaceId: vi.fn().mockResolvedValue(fakeMapping) });
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(fakeTenant) });
        chatRepo = makeChatRepo();
        chatProvider = makeChatProvider();
        
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);
        harness = new AgentHarness(contextAssembler);

        useCase = new ProcessAgentResponseUse(spaceMappingRepo, tenantRepo, chatRepo, harness);
    });

    it('deve processar fluxo de texto (sem tool call) e enviar resposta', async () => {
        const mockLlmProvider = {
            generateResponse: vi.fn().mockResolvedValue({ type: 'text', content: 'Olá! Como posso ajudar?' }),
        };
        vi.mocked(LLMFactory.create).mockReturnValue(mockLlmProvider as any);

        await useCase.execute('spaces/AAAA1111', 'thread-1', 'Olá!', chatProvider);

        expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Olá! Como posso ajudar?');
        expect(chatRepo.save).toHaveBeenCalledOnce();
    });

    it('deve processar fluxo com tool_call: executa ferramenta e gera resposta final', async () => {
        const mockLlmProvider = {
            generateResponse: vi.fn()
                .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'query_logs', parameters: {} } })
                .mockResolvedValueOnce({ type: 'text', content: 'Resultado processado com sucesso.' }),
        };
        vi.mocked(LLMFactory.create).mockReturnValue(mockLlmProvider as any);

        await useCase.execute('spaces/AAAA1111', 'thread-1', 'Quais são os logs de erro?', chatProvider);

        expect(mockLlmProvider.generateResponse).toHaveBeenCalledTimes(2);
        expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Resultado processado com sucesso.');
    });

    it('deve lidar com erro na execução da ferramenta MCP e passar o erro para o LLM', async () => {
        const mockLlmProvider = {
            generateResponse: vi.fn()
                .mockResolvedValueOnce({ type: 'tool_call', tool: { name: 'query_logs', parameters: {} } })
                .mockResolvedValueOnce({ type: 'text', content: 'Erro no Loki, tente novamente de outra forma.' }),
        };
        vi.mocked(LLMFactory.create).mockReturnValue(mockLlmProvider as any);
        
        mockMCPHttpAdapterInstance.executeTool.mockRejectedValue(new Error('Conexão encerrada pelo servidor antes de receber resposta'));

        await useCase.execute('spaces/AAAA1111', 'thread-1', 'Quais são os logs de erro?', chatProvider);

        expect(mockMCPHttpAdapterInstance.executeTool).toHaveBeenCalled();
        expect(mockLlmProvider.generateResponse).toHaveBeenCalledTimes(2);
        
        const lastCallArgs = mockLlmProvider.generateResponse.mock.calls[1];
        const contextArg = lastCallArgs[0];
        const systemMessage = contextArg.messages.find((m: any) => m.role === 'system');
        expect(systemMessage).toBeDefined();
        expect(JSON.parse(systemMessage.content).error).toContain('Falha na execução da ferramenta');
        
        expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Erro no Loki, tente novamente de outra forma.');
    });

    it('deve enviar mensagem de espaço não configurado se o space mapping não existir', async () => {
        spaceMappingRepo = makeSpaceMappingRepo({ findBySpaceId: vi.fn().mockResolvedValue(null) });
        useCase = new ProcessAgentResponseUse(spaceMappingRepo, tenantRepo, chatRepo, harness);

        await useCase.execute('spaces/DESCONHECIDO', 'thread-1', 'Olá!', chatProvider);

        expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Este espaço não está configurado.');
        expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('deve enviar mensagem de indisponibilidade se o tenant não estiver ativo', async () => {
        const inactiveTenant = new Tenant(
            'workspace-abc',
            { provider: 'openai', apiKey: 'sk-test' },
            { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
            false
        );
        tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(inactiveTenant) });
        useCase = new ProcessAgentResponseUse(spaceMappingRepo, tenantRepo, chatRepo, harness);

        await useCase.execute('spaces/AAAA1111', 'thread-1', 'Olá!', chatProvider);

        expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Desculpe, não consigo te atender neste momento.');
        expect(chatRepo.save).not.toHaveBeenCalled();
    });

    it('deve enviar mensagem de erro genérica se o LLM lançar exceção', async () => {
        const mockLlmProvider = {
            generateResponse: vi.fn().mockRejectedValue(new Error('Timeout na API do LLM')),
        };
        vi.mocked(LLMFactory.create).mockReturnValue(mockLlmProvider as any);

        await useCase.execute('spaces/AAAA1111', 'thread-1', 'Olá!', chatProvider);

        expect(chatProvider.sendMessage).toHaveBeenCalledWith(
            'thread-1',
            'Ocorreu um erro ao processar sua solicitação.'
        );
    });

    describe('Cross-Tenant Guard', () => {
        it('deve abortar e avisar o usuário se expectedWorkspaceId for divergente do mapping', async () => {
            await useCase.execute(
                'spaces/AAAA1111',
                'thread-1',
                'Olá!',
                chatProvider,
                'workspace-divergente'
            );

            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-1',
                'Desculpe, não consigo te atender neste momento.'
            );
            expect(chatRepo.save).not.toHaveBeenCalled();
            expect(LLMFactory.create).not.toHaveBeenCalled();
        });

        it('deve abortar se o tenant retornado pelo repositório tiver workspaceId diferente do mapping', async () => {
            const mismatchedTenant = new Tenant(
                'workspace-different-from-mapping',
                { provider: 'openai', apiKey: 'sk-test' },
                { url: 'https://mcp.example.com', apiKey: 'mcp-key' },
                true
            );
            tenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(mismatchedTenant) });
            useCase = new ProcessAgentResponseUse(spaceMappingRepo, tenantRepo, chatRepo, harness);

            await useCase.execute('spaces/AAAA1111', 'thread-1', 'Olá!', chatProvider);

            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-1',
                'Desculpe, não consigo te atender neste momento.'
            );
            expect(chatRepo.save).not.toHaveBeenCalled();
            expect(LLMFactory.create).not.toHaveBeenCalled();
        });
    });

    describe('InvestigationEngine Integration', () => {
        it('deve repassar systemInstructions e playbookIds do InvestigationEngine para o harness quando ativado', async () => {
            const mockEngine: any = {
                evaluate: vi.fn().mockReturnValue({
                    playbookIds: ['api-error'],
                    systemInstructions: 'DIRETRIZ DE ERRO 500',
                    recommendedTools: ['query_logs'],
                    isIncident: true,
                }),
            };

            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-custom',
                    response: 'Diagnóstico concluído.',
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 100,
                }),
            };

            const useCaseWithEngine = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockEngine
            );

            await useCaseWithEngine.execute('spaces/AAAA1111', 'thread-1', 'Erro 500 na API', chatProvider);

            expect(mockEngine.evaluate).toHaveBeenCalledWith('Erro 500 na API', expect.any(ChatContext));
            expect(customHarness.run).toHaveBeenCalledWith(
                expect.objectContaining({
                    systemInstructions: 'DIRETRIZ DE ERRO 500',
                    playbookIds: ['api-error'],
                })
            );
            expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Diagnóstico concluído.');
        });
    });

    describe('Multi-MCP Platform & Contextual Tool Discovery', () => {
        it('deve instanciar CompositeMCPClient e aplicar filtro contextual de domínios quando tenant possuir múltiplos servidores MCP', async () => {
            const multiMcpTenant = new Tenant(
                'workspace-multi',
                { provider: 'openai', apiKey: 'sk-test' },
                { url: 'https://mcp-legacy.example.com', apiKey: 'key' },
                true,
                [
                    { id: 'k8s', name: 'Kubernetes MCP', url: 'https://k8s.example.com', domains: ['kubernetes', 'infra'] },
                    { id: 'loki', name: 'Loki MCP', url: 'https://loki.example.com', domains: ['observability', 'logs'] }
                ]
            );

            const multiMapping = new SpaceMapping('spaces/MULTI123', 'workspace-multi');
            const customSpaceRepo = makeSpaceMappingRepo({ findBySpaceId: vi.fn().mockResolvedValue(multiMapping) });
            const customTenantRepo = makeTenantRepo({ findByWorkspaceId: vi.fn().mockResolvedValue(multiMcpTenant) });

            const mockEngine: any = {
                evaluate: vi.fn().mockReturnValue({
                    playbookIds: ['kubernetes'],
                    domains: ['kubernetes', 'k8s', 'infra'],
                    systemInstructions: 'DIRETRIZ K8S',
                    recommendedTools: ['get_pod_status'],
                    isIncident: true,
                }),
            };

            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-multi',
                    response: 'Pod investigado com sucesso.',
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 80,
                }),
            };

            const multiUseCase = new ProcessAgentResponseUse(
                customSpaceRepo,
                customTenantRepo,
                chatRepo,
                customHarness as any,
                mockEngine
            );

            await multiUseCase.execute('spaces/MULTI123', 'thread-1', 'Pod reiniciando no cluster', chatProvider);

            expect(mockEngine.evaluate).toHaveBeenCalled();
            expect(customHarness.run).toHaveBeenCalledWith(
                expect.objectContaining({
                    tenantId: 'workspace-multi',
                    systemInstructions: 'DIRETRIZ K8S',
                    playbookIds: ['kubernetes'],
                    mcpClient: expect.any(Object),
                })
            );
            expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-1', 'Pod investigado com sucesso.');
        });
    });

    describe('Ciclo de Vida de Sessão & Detecção Conversacional de Encerramento', () => {
        let mockSessionRepo: any;
        let mockInvestigationEngine: any;

        const summaryText = `📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
• Run ID: run-999
• Serviço / Componente: payment-service
• Janela do Incidente: 10:00 - 10:30
💡 HIPÓTESE DE CAUSA RAIZ (RCA):
Timeout no gateway de pagamentos externo.
🛠️ AÇÕES RECOMENDADAS:
1. Ajustar timeout para 5000ms.`;

        beforeEach(() => {
            mockSessionRepo = {
                save: vi.fn().mockResolvedValue(undefined),
                findById: vi.fn().mockResolvedValue(null),
                findActiveByThreadId: vi.fn().mockResolvedValue(null),
                findInactiveSessions: vi.fn().mockResolvedValue([]),
                createIndexes: vi.fn().mockResolvedValue(undefined),
            };

            mockInvestigationEngine = {
                evaluate: vi.fn().mockReturnValue({
                    playbookIds: ['api-error'],
                    domains: ['api'],
                    systemInstructions: 'DIRETRIZ',
                    recommendedTools: [],
                    isIncident: true,
                }),
                hasSessionSummary: vi.fn().mockImplementation((text: string) => /RESUMO EXECUTIVO/i.test(text)),
                extractSessionSummary: vi.fn().mockReturnValue(null),
                stripSessionSummary: vi.fn().mockImplementation((text: string) => text.replace(/📋\s*RESUMO EXECUTIVO DE SESSÃO[\s\S]*/gi, '').trim()),
            };
        });

        it('deve criar uma nova InvestigationSession ativa no primeiro contato e salvá-la', async () => {
            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-1',
                    response: 'Investigação iniciada.',
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 50,
                }),
            };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-1', 'Erro na API', chatProvider);

            expect(mockSessionRepo.findActiveByThreadId).toHaveBeenCalledWith('thread-sess-1', 'workspace-abc');
            expect(mockSessionRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    threadId: 'thread-sess-1',
                    workspaceId: 'workspace-abc',
                    status: 'ACTIVE',
                })
            );
            expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-sess-1', 'Investigação iniciada.');
        });

        it('deve propor encerramento da sessão e anexar prompt de confirmação quando o LLM concluir a análise com SessionSummary', async () => {
            const mockSummary = {
                runId: 'run-999',
                serviceName: 'payment-service',
                toMarkdown: () => '### Resumo Formatado',
            };
            mockInvestigationEngine.extractSessionSummary.mockReturnValue(mockSummary);

            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-999',
                    response: summaryText,
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 80,
                }),
            };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-2', 'Conclua a análise', chatProvider);

            expect(mockSessionRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'AWAITING_CLOSURE_CONFIRMATION',
                    sessionSummary: mockSummary,
                })
            );
            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-sess-2',
                expect.stringContaining('Deseja encerrar esta sessão de investigação?')
            );
            expect(chatProvider.sendMessage).not.toHaveBeenCalledWith(
                'thread-sess-2',
                expect.stringContaining('RESUMO EXECUTIVO DE SESSÃO')
            );
        });

        it('deve remover incondicionalmente o Session Summary da resposta enviada ao chat mesmo se extractSessionSummary retornar null', async () => {
            mockInvestigationEngine.extractSessionSummary.mockReturnValue(null);

            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-unparsed',
                    response: `Análise em andamento dos pods.\n\n${summaryText}`,
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 40,
                }),
            };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-unparsed', 'Status dos pods', chatProvider);

            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-sess-unparsed',
                'Análise em andamento dos pods.'
            );
            expect(chatProvider.sendMessage).not.toHaveBeenCalledWith(
                'thread-sess-unparsed',
                expect.stringContaining('RESUMO EXECUTIVO DE SESSÃO')
            );
        });

        it('deve fechar a sessão com CLOSED_BY_USER quando o operador responder "Sim" em confirmação', async () => {
            const existingSession = {
                id: 'sess-confirm',
                threadId: 'thread-sess-3',
                workspaceId: 'workspace-abc',
                status: 'AWAITING_CLOSURE_CONFIRMATION',
                sessionSummary: {
                    runId: 'run-999',
                    serviceName: 'payment-service',
                    toMarkdown: () => '### Resumo Conclusivo',
                },
                confirmClosure: vi.fn(),
                touch: vi.fn(),
            };
            mockSessionRepo.findActiveByThreadId.mockResolvedValue(existingSession);

            const customHarness = { run: vi.fn() };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-3', 'Sim, pode encerrar', chatProvider);

            expect(existingSession.confirmClosure).toHaveBeenCalledWith(existingSession.sessionSummary);
            expect(mockSessionRepo.save).toHaveBeenCalledWith(existingSession);
            expect(customHarness.run).not.toHaveBeenCalled(); // Não gasta LLM tokens desnecessários
            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-sess-3',
                expect.stringContaining('Sessão de investigação encerrada com sucesso.')
            );
        });

        it('deve reverter para ACTIVE e continuar a investigação quando o operador responder negativamente à confirmação', async () => {
            const existingSession = {
                id: 'sess-reject',
                threadId: 'thread-sess-4',
                workspaceId: 'workspace-abc',
                status: 'AWAITING_CLOSURE_CONFIRMATION',
                cancelClosureProposal: vi.fn(),
                touch: vi.fn(),
            };
            mockSessionRepo.findActiveByThreadId.mockResolvedValue(existingSession);

            const customHarness = {
                run: vi.fn().mockResolvedValue({
                    runId: 'run-cont',
                    response: 'Continuando análise dos pods...',
                    iterations: 1,
                    toolCalls: [],
                    status: 'completed',
                    durationMs: 60,
                }),
            };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-4', 'Não, verifique o banco de dados também', chatProvider);

            expect(existingSession.cancelClosureProposal).toHaveBeenCalled();
            expect(existingSession.touch).toHaveBeenCalled();
            expect(customHarness.run).toHaveBeenCalled();
            expect(chatProvider.sendMessage).toHaveBeenCalledWith('thread-sess-4', 'Continuando análise dos pods...');
        });

        it('deve encerrar imediatamente ao receber comando explícito /encerrar', async () => {
            const existingSession = {
                id: 'sess-cmd',
                threadId: 'thread-sess-5',
                workspaceId: 'workspace-abc',
                status: 'ACTIVE',
                sessionSummary: {
                    toMarkdown: () => '### Resumo Parcial',
                },
                confirmClosure: vi.fn(),
                touch: vi.fn(),
            };
            mockSessionRepo.findActiveByThreadId.mockResolvedValue(existingSession);

            const customHarness = { run: vi.fn() };

            const sessionUseCase = new ProcessAgentResponseUse(
                spaceMappingRepo,
                tenantRepo,
                chatRepo,
                customHarness as any,
                mockInvestigationEngine,
                undefined,
                mockSessionRepo
            );

            await sessionUseCase.execute('spaces/AAAA1111', 'thread-sess-5', '/encerrar', chatProvider);

            expect(existingSession.confirmClosure).toHaveBeenCalledWith(existingSession.sessionSummary);
            expect(mockSessionRepo.save).toHaveBeenCalledWith(existingSession);
            expect(customHarness.run).not.toHaveBeenCalled();
            expect(chatProvider.sendMessage).toHaveBeenCalledWith(
                'thread-sess-5',
                expect.stringContaining('Sessão de investigação encerrada com sucesso pelo operador.')
            );
        });
    });
});

