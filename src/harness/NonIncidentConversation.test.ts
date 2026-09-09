import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { ApiErrorPlaybook } from '../domain/workflows/playbooks/ApiErrorPlaybook.js';
import { LatencyTracePlaybook } from '../domain/workflows/playbooks/LatencyTracePlaybook.js';
import { KubernetesPlaybook } from '../domain/workflows/playbooks/KubernetesPlaybook.js';
import { DatabasePlaybook } from '../domain/workflows/playbooks/DatabasePlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';

describe('NonIncidentConversation Test (Zero Regressão)', () => {
    it('não deve ativar playbooks em perguntas informativas ou rotineiras, mantendo fluxo conversacional limpo', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new ApiErrorPlaybook());
        registry.register(new LatencyTracePlaybook());
        registry.register(new KubernetesPlaybook());
        registry.register(new DatabasePlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const regularQuestions = [
            'Como posso configurar as credenciais do Slack no painel?',
            'Qual é o horário de atendimento da equipe de suporte?',
            'Onde encontro a documentação de autenticação JWT?',
        ];

        for (const question of regularQuestions) {
            const plan = investigationEngine.evaluate(question);
            expect(plan).toBeNull();
        }

        const userMessage = 'Como posso configurar as credenciais do Slack no painel?';
        const context = new ChatContext('thread-info', 'ws-test');
        const plan = investigationEngine.evaluate(userMessage, context);
        expect(plan).toBeNull();

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({ tools: [] }),
            executeTool: vi.fn().mockResolvedValue({ result: 'ok' }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn().mockResolvedValueOnce({
                type: 'text',
                content: 'Para configurar o Slack, acesse a rota /api/chat-configs informando o botToken e signingSecret.',
            }),
        };

        const harness = new AgentHarness(contextAssembler);
        const result = await harness.run({
            tenantId: 'tenant-test',
            workspaceId: 'ws-test',
            threadId: 'thread-info',
            userMessage,
            context,
            llmProvider,
            mcpClient,
            systemInstructions: plan?.systemInstructions,
            playbookIds: plan?.playbookIds,
        });

        expect(result.status).toBe('completed');
        expect(result.playbookIds).toBeUndefined();
        expect(result.iterations).toBe(0);
        expect(result.response).toBe('Para configurar o Slack, acesse a rota /api/chat-configs informando o botToken e signingSecret.');
        expect(result.response).not.toContain('RESUMO EXECUTIVO DE SESSÃO');

        const summary = investigationEngine.extractSessionSummary(result.response, result.runId);
        expect(summary).toBeNull();
    });
});
