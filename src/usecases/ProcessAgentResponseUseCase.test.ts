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
});
