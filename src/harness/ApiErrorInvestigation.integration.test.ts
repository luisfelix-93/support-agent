import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { ApiErrorPlaybook } from '../domain/workflows/playbooks/ApiErrorPlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';

describe('ApiErrorInvestigation Integration Test', () => {
    it('deve executar o fluxo completo de investigação de erro 500 com Loki e Prometheus', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new ApiErrorPlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const userMessage = 'A API de pagamentos está retornando erro 500 há 15 minutos';
        const context = new ChatContext('thread-api-error', 'ws-test');

        const investigationPlan = investigationEngine.evaluate(userMessage, context);
        expect(investigationPlan).not.toBeNull();
        expect(investigationPlan!.playbookIds).toContain('api-error');

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'loki_query_logs', description: 'Busca logs no Grafana Loki' },
                    { name: 'prometheus_query', description: 'Executa queries no Prometheus' },
                ],
            }),
            executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
                if (toolName === 'loki_query_logs') {
                    return {
                        logs: [
                            '2026-09-09T13:30:00Z [ERROR] NullPointerException at com.payment.service.ProcessPayment(Payment.java:42)',
                            '2026-09-09T13:30:05Z [ERROR] Failed to process transaction: null reference',
                        ],
                    };
                }
                if (toolName === 'prometheus_query') {
                    return {
                        metric: 'http_requests_total{status="500"}',
                        value: '42.5 req/s spike starting at 13:30:00Z',
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                // Iteração 1: consulta logs de erro no Loki
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'loki_query_logs',
                        parameters: { query: '{service="payment-api", level="error"}' },
                    },
                    usage: { inputTokens: 100, outputTokens: 20 },
                } as any)
                // Iteração 2: consulta métricas de falha no Prometheus
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'prometheus_query',
                        parameters: { query: 'sum(rate(http_requests_total{status="500"}[5m]))' },
                    },
                    usage: { inputTokens: 120, outputTokens: 25 },
                } as any)
                // Iteração 3: síntese conclusiva com Session Summary
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Investiguei o incidente reportado e coletei evidências nos logs e métricas.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-api-error-1
• Serviço / Componente: payment-api
• Janela do Incidente: 13:30:00Z até Em andamento
• Playbooks Ativados: api-error

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - NullPointerException at com.payment.service.ProcessPayment(Payment.java:42)
  - Failed to process transaction: null reference
• Métricas:
  - 42.5 req/s spike de HTTP 500 no Prometheus a partir de 13:30:00Z

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
A regressão decorre de um NullPointerException no método ProcessPayment ao tentar acessar o objeto de antifraude que veio nulo no payload.

🛠️ AÇÕES RECOMENDADAS:
1. Realizar rollback do deploy da versão v2.4.1 do payment-api
2. Adicionar null-check defensivo na linha 42 do Payment.java
═══════════════════════════════════════════════════════════`,
                    usage: { inputTokens: 150, outputTokens: 180 },
                }),
        };

        const savedRuns: any[] = [];
        const agentRunRepository: IAgentRunRepository = {
            save: vi.fn().mockImplementation(async (r) => {
                savedRuns.push(r);
            }),
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
            threadId: 'thread-api-error',
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
        expect(result.toolCalls[0].toolName).toBe('loki_query_logs');
        expect(result.toolCalls[1].toolName).toBe('prometheus_query');
        expect(result.playbookIds).toEqual(['api-error']);

        expect(savedRuns).toHaveLength(1);
        expect(savedRuns[0].playbookIds).toEqual(['api-error']);

        const extractedSummary = investigationEngine.extractSessionSummary(result.response, result.runId, result.playbookIds);
        expect(extractedSummary).not.toBeNull();
        expect(extractedSummary!.serviceName).toBe('payment-api');
        expect(extractedSummary!.rootCauseHypothesis).toContain('NullPointerException');
        expect(extractedSummary!.evidence.logs).toHaveLength(2);
        expect(extractedSummary!.evidence.metrics).toHaveLength(1);
        expect(extractedSummary!.recommendedActions).toHaveLength(2);
    });
});
