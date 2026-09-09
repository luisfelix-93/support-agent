import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { LatencyTracePlaybook } from '../domain/workflows/playbooks/LatencyTracePlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';

describe('LatencyInvestigation Integration Test', () => {
    it('deve diagnosticar alta latência identificando span gargalo no Grafana Tempo e métricas p95', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new LatencyTracePlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const userMessage = 'O checkout está com lentidão extrema e timeout para os clientes';
        const context = new ChatContext('thread-latency', 'ws-test');

        const investigationPlan = investigationEngine.evaluate(userMessage, context);
        expect(investigationPlan).not.toBeNull();
        expect(investigationPlan!.playbookIds).toContain('latency-trace');

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'tempo_query_trace', description: 'Busca traces no Grafana Tempo' },
                    { name: 'prometheus_query', description: 'Executa queries no Prometheus' },
                ],
            }),
            executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
                if (toolName === 'prometheus_query') {
                    return {
                        metric: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
                        value: '9.2s (baseline normal: 250ms)',
                    };
                }
                if (toolName === 'tempo_query_trace') {
                    return {
                        traceId: 'tr-checkout-888',
                        spans: [
                            { spanId: 'span-1', name: 'POST /checkout', durationMs: 9100 },
                            { spanId: 'span-2', name: 'db.query_orders_history', durationMs: 8200, dbStatement: 'SELECT * FROM orders WHERE ...' },
                        ],
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                // Iteração 1: consulta métricas de latência p95 no Prometheus
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'prometheus_query',
                        parameters: { query: 'http_request_duration_p95' },
                    },
                    usage: { inputTokens: 100, outputTokens: 20 },
                } as any)
                // Iteração 2: consulta traces distribuídos no Tempo para isolar o span lento
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'tempo_query_trace',
                        parameters: { service: 'checkout-service', minDuration: '5s' },
                    },
                    usage: { inputTokens: 130, outputTokens: 25 },
                } as any)
                // Iteração 3: síntese conclusiva com Session Summary
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Diagnóstico de performance concluído.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-latency-1
• Serviço / Componente: checkout-service
• Janela do Incidente: 13:40 até Em andamento
• Playbooks Ativados: latency-trace

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - Nenhum erro explícito reportado
• Métricas:
  - p95 de latência atingiu 9.2s (normal: 250ms)
• Traces:
  - Span db.query_orders_history demorou 8200ms de um total de 9100ms no trace tr-checkout-888

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
A lentidão se deve a uma query pesada sem índice adequado executada na tabela de pedidos durante a finalização da compra.

🛠️ AÇÕES RECOMENDADAS:
1. Adicionar índice composto nas colunas de filtro da tabela orders
2. Aplicar timeout defensivo de 2 segundos na consulta ao banco
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
            threadId: 'thread-latency',
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
        expect(result.toolCalls[0].toolName).toBe('prometheus_query');
        expect(result.toolCalls[1].toolName).toBe('tempo_query_trace');
        expect(result.playbookIds).toEqual(['latency-trace']);

        const extractedSummary = investigationEngine.extractSessionSummary(result.response, result.runId, result.playbookIds);
        expect(extractedSummary).not.toBeNull();
        expect(extractedSummary!.serviceName).toBe('checkout-service');
        expect(extractedSummary!.rootCauseHypothesis).toContain('query pesada sem índice');
        expect(extractedSummary!.evidence.metrics[0]).toContain('p95 de latência atingiu 9.2s');
        expect(extractedSummary!.recommendedActions).toHaveLength(2);
    });
});
