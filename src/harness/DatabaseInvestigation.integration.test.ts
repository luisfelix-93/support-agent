import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { DatabasePlaybook } from '../domain/workflows/playbooks/DatabasePlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';

describe('DatabaseInvestigation Integration Test', () => {
    it('deve diagnosticar timeout de conexão identificando pool de conexões esgotado e slow query', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new DatabasePlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const userMessage = 'O sistema de checkout começou a falhar com timeout de conexão no banco de dados';
        const context = new ChatContext('thread-db', 'ws-test');

        const investigationPlan = investigationEngine.evaluate(userMessage, context);
        expect(investigationPlan).not.toBeNull();
        expect(investigationPlan!.playbookIds).toContain('database');

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'query_db_metrics', description: 'Consulta métricas do pool de conexões do banco' },
                    { name: 'query_slow_queries', description: 'Consulta queries ativas com longa duração' },
                ],
            }),
            executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
                if (toolName === 'query_db_metrics') {
                    return {
                        activeConnections: 100,
                        maxConnections: 100,
                        waitingThreads: 45,
                        poolUtilization: '100%',
                    };
                }
                if (toolName === 'query_slow_queries') {
                    return {
                        slowQueries: [
                            { pid: 14201, duration: '48s', query: 'SELECT * FROM orders WHERE status = "pending" ORDER BY created_at' },
                        ],
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                // Iteração 1: consulta métricas de conexões
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'query_db_metrics',
                        parameters: { db: 'postgres-prod' },
                    },
                    usage: { inputTokens: 100, outputTokens: 20 },
                } as any)
                // Iteração 2: consulta queries lentas
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'query_slow_queries',
                        parameters: { db: 'postgres-prod', thresholdSeconds: 10 },
                    },
                    usage: { inputTokens: 120, outputTokens: 25 },
                } as any)
                // Iteração 3: síntese conclusiva com Session Summary
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Diagnóstico de banco de dados concluído.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-db-1
• Serviço / Componente: postgres-prod
• Janela do Incidente: 14:00 até Em andamento
• Playbooks Ativados: database

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - HikariPool-1 - Connection is not available, request timed out after 30000ms
• Métricas:
  - activeConnections: 100/100 (Uso do pool: 100% com 45 threads bloqueadas)
• Banco de Dados:
  - Query PID 14201 em execução há 48s sem índice adequado na tabela orders

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
Esgotamento completo do pool de conexões (100/100) provocado por uma consulta sequencial sem índice na tabela orders, bloqueando 45 threads simultâneas de checkout.

🛠️ AÇÕES RECOMENDADAS:
1. Encerrar a query travada (pg_terminate_backend(14201))
2. Criar índice composto na tabela orders (status, created_at)
3. Aumentar temporariamente o connection pool do HikariCP
═══════════════════════════════════════════════════════════`,
                    usage: { inputTokens: 160, outputTokens: 190 },
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
            threadId: 'thread-db',
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
        expect(result.toolCalls[0].toolName).toBe('query_db_metrics');
        expect(result.toolCalls[1].toolName).toBe('query_slow_queries');
        expect(result.playbookIds).toEqual(['database']);

        const extractedSummary = investigationEngine.extractSessionSummary(result.response, result.runId, result.playbookIds);
        expect(extractedSummary).not.toBeNull();
        expect(extractedSummary!.serviceName).toBe('postgres-prod');
        expect(extractedSummary!.rootCauseHypothesis).toContain('Esgotamento completo do pool de conexões');
        expect(extractedSummary!.recommendedActions).toHaveLength(3);
    });
});
