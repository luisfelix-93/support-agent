import { describe, it, expect, vi } from 'vitest';
import { AgentHarness } from './AgentHarness.js';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import { KubernetesPlaybook } from '../domain/workflows/playbooks/KubernetesPlaybook.js';
import { ApiErrorPlaybook } from '../domain/workflows/playbooks/ApiErrorPlaybook.js';
import { CompositeMCPClient } from '../infrastructure/mcp/CompositeMCPClient.js';
import { ToolGovernanceService } from '../services/ToolGovernanceService.js';
import { CircuitBreaker } from '../infrastructure/resilience/CircuitBreaker.js';
import type { IMCPClient } from '../domain/ports/IMCPClient.js';
import type { ILLMProvider } from '../domain/ports/ILLMProvider.js';
import type { IAgentRunRepository } from '../domain/ports/IAgentRunRepository.js';
import type { ToolCall } from '../domain/ToolCall.js';

describe('Multi-MCP Investigation E2E Integration Test', () => {
    it('deve orquestrar investigação Multi-MCP com roteamento de múltiplos servidores, prefix stripping, governança e resiliência', async () => {
        const tokenCounter = new TiktokenAdapter();
        const contextAssembler = new ContextAssembler(tokenCounter);

        // 1. Playbook Registry & Investigation Engine
        const playbookRegistry = new PlaybookRegistry();
        playbookRegistry.register(new KubernetesPlaybook());
        playbookRegistry.register(new ApiErrorPlaybook());
        const investigationEngine = new InvestigationEngine(playbookRegistry);

        // 2. Mock dos servidores MCP filhos
        // Servidor 1: Kubernetes MCP
        const mockK8sClient: IMCPClient = {
            connect: vi.fn().mockResolvedValue({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'k8s-mcp', version: '1.0' } }),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'get_pods', description: 'Lista pods no namespace informado' },
                    { name: 'describe_pod', description: 'Descreve status e eventos de um pod' },
                    { name: 'delete_pod', description: 'Deleta um pod do cluster (ação destrutiva)' }
                ]
            }),
            executeTool: vi.fn().mockImplementation(async (tool: ToolCall) => {
                if (tool.name === 'get_pods') {
                    return {
                        pods: [
                            { name: 'payment-svc-78f9-abcd', status: 'CrashLoopBackOff', restarts: 12 }
                        ]
                    };
                }
                if (tool.name === 'describe_pod') {
                    return {
                        name: 'payment-svc-78f9-abcd',
                        lastTerminationReason: 'OOMKilled',
                        exitCode: 137,
                        limits: { memory: '512Mi' }
                    };
                }
                if (tool.name === 'delete_pod') {
                    return { deleted: true };
                }
                return { result: 'unknown' };
            }),
            close: vi.fn().mockResolvedValue(undefined)
        };

        // Servidor 2: Observability MCP (Loki / Prometheus)
        const mockObsClient: IMCPClient = {
            connect: vi.fn().mockResolvedValue({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'obs-mcp', version: '1.0' } }),
            isConnected: vi.fn().mockReturnValue(true),
            listTools: vi.fn().mockResolvedValue({
                tools: [
                    { name: 'query_logs', description: 'Consulta logs de serviços' },
                    { name: 'query_metrics', description: 'Consulta métricas de telemetria' }
                ]
            }),
            executeTool: vi.fn().mockImplementation(async (tool: ToolCall) => {
                if (tool.name === 'query_logs') {
                    return {
                        logs: [
                            '2026-09-13T20:55:01Z java.lang.OutOfMemoryError: Java heap space',
                            '2026-09-13T20:55:02Z Dumping heap to java_pid1.hprof...'
                        ]
                    };
                }
                return { result: 'ok' };
            }),
            close: vi.fn().mockResolvedValue(undefined)
        };

        // Servidor 3: Servidor Instável (demonstrando isolamento por Circuit Breaker)
        const cbFailing = new CircuitBreaker({ name: 'mcp-unstable-cb', failureThreshold: 1 });
        const mockUnstableClient: IMCPClient = {
            connect: vi.fn().mockRejectedValue(new Error('Servidor instável offline')),
            isConnected: vi.fn().mockReturnValue(false),
            listTools: vi.fn().mockRejectedValue(new Error('Timeout de conexão')),
            executeTool: vi.fn().mockRejectedValue(new Error('Falha no servidor')),
            close: vi.fn().mockResolvedValue(undefined)
        };

        // 3. Tool Governance Service
        const governanceService = new ToolGovernanceService();

        // 4. Criação do CompositeMCPClient com os 3 servidores registrados
        const compositeClient = new CompositeMCPClient(
            [
                {
                    id: 'k8s',
                    name: 'Kubernetes Cluster MCP',
                    client: mockK8sClient,
                    domains: ['kubernetes', 'infra']
                },
                {
                    id: 'observability',
                    name: 'Observability MCP',
                    client: mockObsClient,
                    domains: ['observability', 'logs', 'metrics', 'traces']
                },
                {
                    id: 'unstable',
                    name: 'Unstable Legacy MCP',
                    client: mockUnstableClient,
                    domains: ['legacy']
                }
            ],
            governanceService,
            {
                // Política de governança: proíbe explicitamente deleções
                rules: [
                    { pattern: '*delete*', riskLevel: 'FORBIDDEN' }
                ]
            }
        );

        await compositeClient.connect();
        expect(compositeClient.isConnected()).toBe(true);

        // 5. Avaliação contextual com o InvestigationEngine
        const userPrompt = 'O pod do payment-svc está reiniciando em crashloopbackoff no k8s com erro 500';
        const context = new ChatContext('thread-multi-mcp', 'tenant-multi');

        const plan = investigationEngine.evaluate(userPrompt, context);
        expect(plan).not.toBeNull();
        expect(plan!.playbookIds).toContain('kubernetes');
        expect(plan!.domains).toContain('kubernetes');

        // 6. Teste de Tool Discovery Contextual: busca ferramentas apenas nos domínios pertinentes
        const discovered = await compositeClient.listTools({ domains: plan!.domains });
        const toolNames = discovered.tools.map(t => t.name);

        // Deve conter ferramentas k8s com namespace
        expect(toolNames).toContain('k8s__get_pods');
        expect(toolNames).toContain('k8s__describe_pod');
        expect(toolNames).toContain('k8s__delete_pod');
        // Não deve conter ferramentas de domínios não solicitados como 'legacy'
        expect(toolNames.some(t => t.startsWith('unstable__'))).toBe(false);

        // 7. Teste de Governança: tentativa de executar tool proibida
        const forbiddenCallResult = await compositeClient.executeTool({
            name: 'k8s__delete_pod',
            parameters: { pod: 'payment-svc-78f9-abcd' }
        });
        expect(forbiddenCallResult.blocked).toBe(true);
        expect(forbiddenCallResult.riskLevel).toBe('FORBIDDEN');
        expect(mockK8sClient.executeTool).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'delete_pod' }));

        // 8. Execução E2E no AgentHarness com chamadas multi-servidor (k8s + observability)
        const mockAgentRunRepo: IAgentRunRepository = {
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
            mockAgentRunRepo
        );

        // Provedor LLM simulando 3 passos:
        // Passo 1: Chama k8s__get_pods
        // Passo 2: Chama observability__query_logs
        // Passo 3: Conclusão com Session Summary
        const mockLlmProvider: ILLMProvider = {
            generateResponse: vi.fn()
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'k8s__get_pods',
                        parameters: { namespace: 'production' }
                    },
                    usage: { inputTokens: 150, outputTokens: 30 }
                } as any)
                .mockResolvedValueOnce({
                    type: 'tool_call',
                    tool: {
                        name: 'observability__query_logs',
                        parameters: { service: 'payment-svc' }
                    },
                    usage: { inputTokens: 210, outputTokens: 40 }
                } as any)
                .mockResolvedValueOnce({
                    type: 'text',
                    content: `Diagnóstico consolidado com sucesso em múltiplos servidores MCP.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-multi-mcp-1
• Serviço / Componente: payment-svc
• Janela do Incidente: 20:50 até 21:00 UTC
• Playbooks Ativados: kubernetes, api-error

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - java.lang.OutOfMemoryError: Java heap space
• Métricas:
  - Pod CrashLoopBackOff com 12 reinícios e Exit Code 137 (OOMKilled)

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
O serviço payment-svc excedeu o limite de memória de 512Mi durante pico de carga, disparando OOMKilled pelo Kubernetes.

🛠️ AÇÕES RECOMENDADAS:
1. Elevar temporariamente limits.memory para 1Gi no Deployment.
2. Analisar heap dump para mitigar leak de memória na JVM.
═══════════════════════════════════════════════════════════`,
                    usage: { inputTokens: 300, outputTokens: 150 }
                } as any)
        };

        // Inclui também a tool de logs para permitir ao LLM consultar telemetria
        const allDiscoveredTools = await compositeClient.listTools();

        const harnessResult = await harness.run({
            tenantId: 'tenant-multi',
            workspaceId: 'ws-multi',
            threadId: 'thread-multi-mcp',
            userMessage: userPrompt,
            context,
            llmProvider: mockLlmProvider,
            mcpClient: compositeClient,
            tools: allDiscoveredTools.tools,
            systemInstructions: plan!.systemInstructions,
            playbookIds: plan!.playbookIds
        });

        // 9. Asserções de Resultado e Comportamento
        expect(harnessResult.status).toBe('completed');
        expect(harnessResult.iterations).toBe(2);
        expect(harnessResult.toolCalls.length).toBe(2);

        // Verifica que o prefix stripping ocorreu: o cliente k8s recebeu 'get_pods', NÃO 'k8s__get_pods'
        expect(mockK8sClient.executeTool).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'get_pods' })
        );

        // Verifica que o cliente observability recebeu 'query_logs', NÃO 'observability__query_logs'
        expect(mockObsClient.executeTool).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'query_logs' })
        );

        // Verifica se o resumo executivo foi estruturado no contexto
        expect(harnessResult.response).toContain('RESUMO EXECUTIVO DE SESSÃO');
        expect(harnessResult.response).toContain('java.lang.OutOfMemoryError');
        expect(harnessResult.response).toContain('OOMKilled');

        // Confirma que o AgentRunRepository foi acionado
        expect(mockAgentRunRepo.save).toHaveBeenCalled();
        const savedRun = (mockAgentRunRepo.save as any).mock.calls[0][0];
        expect(savedRun.tenantId).toBe('tenant-multi');
        expect(savedRun.status).toBe('completed');
    });
});
