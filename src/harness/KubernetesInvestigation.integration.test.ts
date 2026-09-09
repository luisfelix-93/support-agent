import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { KubernetesPlaybook } from '../domain/workflows/playbooks/KubernetesPlaybook.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';

describe('KubernetesInvestigation Integration Test', () => {
    it('deve diagnosticar pod em CrashLoopBackOff identificando evento de OOMKilled', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        const registry = new PlaybookRegistry();
        registry.register(new KubernetesPlaybook());
        const investigationEngine = new InvestigationEngine(registry);

        const userMessage = 'O pod catalog-svc-789 está reiniciando sem parar em CrashLoopBackOff';
        const context = new ChatContext('thread-k8s', 'ws-test');

        const investigationPlan = investigationEngine.evaluate(userMessage, context);
        expect(investigationPlan).not.toBeNull();
        expect(investigationPlan!.playbookIds).toContain('kubernetes');

        const mcpClient: IMCPClient = {
            connect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'get_pod_status', description: 'Consulta status de pods no cluster' },
                    { name: 'get_cluster_events', description: 'Consulta eventos do Kubernetes' },
                ],
            }),
            executeTool: vi.fn().mockImplementation(async (toolName: string, args: any) => {
                if (toolName === 'get_pod_status') {
                    return {
                        podName: 'catalog-svc-789',
                        status: 'CrashLoopBackOff',
                        restarts: 12,
                        ready: '0/1',
                    };
                }
                if (toolName === 'get_cluster_events') {
                    return {
                        events: [
                            'Event: Pod catalog-svc-789 - Reason: OOMKilled - ExitCode: 137 - Consumo: 512Mi excedeu limite de 512Mi',
                        ],
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn(),
        };

        const llmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                // Iteração 1: consulta status do pod
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'get_pod_status',
                        parameters: { pod: 'catalog-svc-789' },
                    },
                    usage: { inputTokens: 100, outputTokens: 20 },
                } as any)
                // Iteração 2: consulta eventos do cluster
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'get_cluster_events',
                        parameters: { pod: 'catalog-svc-789' },
                    },
                    usage: { inputTokens: 120, outputTokens: 25 },
                } as any)
                // Iteração 3: síntese conclusiva com Session Summary
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Investigação de infraestrutura concluída.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-k8s-1
• Serviço / Componente: catalog-svc
• Janela do Incidente: Últimos 30 minutos
• Playbooks Ativados: kubernetes

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - ExitCode 137 (SIGKILL pelo kernel do SO)
• Métricas:
  - Consumo de memória atingiu o limite de 512Mi
• Infraestrutura / Kubernetes:
  - Pod catalog-svc-789 com 12 restarts e status CrashLoopBackOff
  - Evento OOMKilled confirmado nos eventos do namespace

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
O pod catalog-svc-789 foi finalizado com Exit Code 137 por OOMKilled (Out Of Memory) devido a um pico de alocação de memória na carga de catálogo que excedeu o resources.limits.memory de 512Mi.

🛠️ AÇÕES RECOMENDADAS:
1. Ajustar o limite de memória no deployment para 1Gi (resources.limits.memory: 1Gi)
2. Inspecionar o heap dump da aplicação para identificar possível vazamento de memória
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
            threadId: 'thread-k8s',
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
        expect(result.toolCalls[0].toolName).toBe('get_pod_status');
        expect(result.toolCalls[1].toolName).toBe('get_cluster_events');
        expect(result.playbookIds).toEqual(['kubernetes']);

        const extractedSummary = investigationEngine.extractSessionSummary(result.response, result.runId, result.playbookIds);
        expect(extractedSummary).not.toBeNull();
        expect(extractedSummary!.serviceName).toBe('catalog-svc');
        expect(extractedSummary!.rootCauseHypothesis).toContain('Exit Code 137 por OOMKilled');
        expect(extractedSummary!.recommendedActions).toHaveLength(2);
    });
});
