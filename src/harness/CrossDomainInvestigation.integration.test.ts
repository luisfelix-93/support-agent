import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { ApiErrorPlaybook } from '../domain/workflows/playbooks/ApiErrorPlaybook.js';
import { DatabasePlaybook } from '../domain/workflows/playbooks/DatabasePlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';

describe('CrossDomainInvestigation Integration Test', () => {
    it('deve orquestrar múltiplos playbooks simultâneos (API + Banco de Dados) correlacionando erro 500 com pool esgotado', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new ApiErrorPlaybook());
        registry.register(new DatabasePlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const userMessage = 'O serviço de checkout está retornando erro 500 porque a conexão com o banco de dados está falhando';
        const context = new ChatContext('thread-cross-domain', 'ws-test');

        const investigationPlan = investigationEngine.evaluate(userMessage, context);
        expect(investigationPlan).not.toBeNull();
        expect(investigationPlan!.playbookIds).toContain('api-error');
        expect(investigationPlan!.playbookIds).toContain('database');

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'loki_query_logs', description: 'Consulta logs de erro' },
                    { name: 'query_db_metrics', description: 'Consulta métricas do pool do banco' },
                ],
            }),
            executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
                if (toolName === 'loki_query_logs') {
                    return {
                        logs: [
                            '2026-09-09T14:02:10Z [ERROR] HTTP 500 POST /checkout - SQLTransientConnectionException: HikariPool-1 - Connection is not available',
                        ],
                    };
                }
                if (toolName === 'query_db_metrics') {
                    return {
                        activeConnections: 100,
                        maxConnections: 100,
                        waitingClients: 32,
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                // Iteração 1: consulta logs da API
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'loki_query_logs',
                        parameters: { service: 'checkout-service' },
                    },
                    usage: { inputTokens: 110, outputTokens: 20 },
                } as any)
                // Iteração 2: consulta métricas de conexões do banco
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'query_db_metrics',
                        parameters: { pool: 'HikariPool-1' },
                    },
                    usage: { inputTokens: 130, outputTokens: 25 },
                } as any)
                // Iteração 3: síntese conclusiva com Session Summary
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Diagnóstico cruzado concluído.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-cross-1
• Serviço / Componente: checkout-service / postgres-db
• Janela do Incidente: 14:00 até Em andamento
• Playbooks Ativados: api-error, database

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - SQLTransientConnectionException: HikariPool-1 - Connection is not available
• Métricas:
  - 100/100 conexões ocupadas com 32 threads bloqueadas

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
Os erros HTTP 500 no checkout são originados diretamente pela exaustão do pool de conexões com o PostgreSQL, impedindo que novas transações de compra sejam processadas.

🛠️ AÇÕES RECOMENDADAS:
1. Elevar temporariamente o tamanho do pool do HikariCP de 100 para 150
2. Inspecionar transações com lock pendente no banco
═══════════════════════════════════════════════════════════`,
                    usage: { inputTokens: 160, outputTokens: 180 },
                }),
        };

        const agentRunRepository: IAgentRunRepository = {
            save: vi.fn().mockResolvedValue(undefined),
            findByRunId: vi.fn().mockResolvedValue(null),
            findByTenant: vi.fn().mockResolvedValue([]),
            aggregateCostByTenant: vi.fn().mockResolvedValue([]),
            aggregateToolAnalytics: vi.fn().mockResolvedValue([]),
            aggregateLLMAnalytics: vi.fn().mockResolvedValue([]),
        };

        const harness = new AgentHarness(
            contextAssembler,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            agentRunRepository
        );

        const result = await harness.run({
            tenantId: 'tenant-test',
            workspaceId: 'ws-test',
            threadId: 'thread-cross-domain',
            userMessage,
            context,
            llmProvider,
            mcpClient,
            tools: (await mcpClient.listTools()).tools,
            systemInstructions: investigationPlan!.systemInstructions,
            playbookIds: investigationPlan!.playbookIds,
        });

        expect(result.status).toBe('completed');
        expect(result.iterations).toBe(2);
        expect(result.toolCalls).toHaveLength(2);
        expect(result.playbookIds).toEqual(['api-error', 'database']);

        const extractedSummary = investigationEngine.extractSessionSummary(result.response, result.runId, result.playbookIds);
        expect(extractedSummary).not.toBeNull();
        expect(extractedSummary!.playbooksInvolved).toEqual(['api-error', 'database']);
        expect(extractedSummary!.rootCauseHypothesis).toContain('exaustão do pool de conexões com o PostgreSQL');
    });
});
