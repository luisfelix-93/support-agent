import crypto from "crypto";
import type { IAgentHarness, AgentRunInput, AgentRunResult } from "../domain/ports/IAgentHarness.js";
import type { IShortTermMemory } from "../domain/ports/IShortTermMemory.js";
import type { IContextAssembler } from "../domain/ports/IContextAssembler.js";
import type { IMemoryRepository } from "../domain/ports/IMemoryRepository.js";
import type { IQueueService } from "../domain/ports/IQueueService.js";
import type { IEmbeddingProvider } from "../domain/ports/IEmbeddingProvider.js";
import type { IAgentRunRepository } from "../domain/ports/IAgentRunRepository.js";
import type { Memory } from "../domain/Memory.js";
import { AgentRun, type ToolCallRecord } from "../domain/AgentRun.js";
import type { LLMCallRecord } from "../domain/LLMCallRecord.js";
import { calculateCost } from "../domain/pricing/LLMPricingTable.js";
import { Message } from "../domain/Message.js";
import { ExecutionPolicy } from "./ExecutionPolicy.js";
import { logger } from "../config/logger.js";
import {
    agentRunsTotal,
    agentRunsFailedTotal,
    agentRunDurationSeconds,
    agentToolCallsTotal
} from "../infrastructure/metrics/AgentMetrics.js";
import {
    agentLlmTokensTotal,
    agentRunCostUsd,
    agentContextUtilization
} from "../infrastructure/metrics/EvaluationMetrics.js";
import { withSpan } from "../infrastructure/tracing/TracerProvider.js";
import { CircuitBreakerOpenError } from "../infrastructure/resilience/CircuitBreaker.js";

const baseLog = logger.child({ module: 'AgentHarness' });

export class AgentHarness implements IAgentHarness {
    constructor(
        private readonly contextAssembler: IContextAssembler,
        private readonly shortTermMemory?: IShortTermMemory,
        private readonly executionPolicy: ExecutionPolicy = new ExecutionPolicy(),
        private readonly memoryRepository?: IMemoryRepository,
        private readonly queueService?: IQueueService,
        private readonly embeddingProvider?: IEmbeddingProvider,
        private readonly agentRunRepository?: IAgentRunRepository
    ) {}

    async run(input: AgentRunInput): Promise<AgentRunResult> {
        return withSpan(
            'agent.execute',
            {
                attributes: {
                    'app.tenant_id': input.tenantId,
                    'app.workspace_id': input.workspaceId,
                    'app.thread_id': input.threadId,
                },
            },
            async (rootSpan) => {
                const runId = crypto.randomUUID();
                rootSpan.setAttribute('agent.run_id', runId);
                const startTime = Date.now();
                const log = baseLog.child({ runId, tenantId: input.tenantId, threadId: input.threadId });

                log.info('Iniciando execução do Agent Harness.');

                const run = new AgentRun(
                    runId,
                    input.tenantId,
                    input.workspaceId,
                    input.threadId
                );
                run.userMessage = input.userMessage;

                let finalResponseText = '';
                let status: 'completed' | 'failed' | 'max_iterations' = 'completed';

                let timeoutTriggered = false;
                const abortController = new AbortController();
                const globalTimeoutTimer = setTimeout(() => {
                    timeoutTriggered = true;
                    abortController.abort();
                    log.warn({ maxRunTimeMs: this.executionPolicy.maxRunTimeMs }, 'Timeout global atingido no AgentHarness.');
                }, this.executionPolicy.maxRunTimeMs);

                const generateLlmWithTimeout = async (ctx: any, tools?: any[]) => {
                    let timer: NodeJS.Timeout | undefined;
                    const timeoutPromise = new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                            reject(new Error(`Timeout de ${this.executionPolicy.llmTimeoutMs}ms no LLM`));
                        }, this.executionPolicy.llmTimeoutMs);
                    });

                    const callStartTime = Date.now();
                    try {
                        const response = await Promise.race([
                            input.llmProvider.generateResponse(ctx, tools),
                            timeoutPromise,
                        ]);
                        const latencyMs = Date.now() - callStartTime;

                        const provider = input.llmProvider.providerName || 'unknown';
                        const model = input.llmProvider.modelName || 'unknown';
                        const inputTokens = response.usage?.inputTokens ?? 0;
                        const outputTokens = response.usage?.outputTokens ?? 0;
                        const totalTokens = response.usage?.totalTokens ?? (inputTokens + outputTokens);
                        const costUsd = calculateCost(model, inputTokens, outputTokens);

                        const callRecord: LLMCallRecord = {
                            provider,
                            model,
                            inputTokens,
                            outputTokens,
                            totalTokens,
                            latencyMs,
                            resultType: response.type,
                            costUsd,
                        };
                        run.recordLLMCall(callRecord);

                        if (inputTokens > 0) {
                            agentLlmTokensTotal.inc({ tenantId: input.tenantId, provider, model, direction: 'input' }, inputTokens);
                        }
                        if (outputTokens > 0) {
                            agentLlmTokensTotal.inc({ tenantId: input.tenantId, provider, model, direction: 'output' }, outputTokens);
                        }
                        if (costUsd > 0) {
                            agentRunCostUsd.inc({ tenantId: input.tenantId, provider, model }, costUsd);
                        }

                        return response;
                    } finally {
                        if (timer) clearTimeout(timer);
                    }
                };

                const isCircuitBreakerOpen = (client: any): boolean => {
                    try {
                        if (typeof client.getCircuitBreaker === 'function') {
                            return client.getCircuitBreaker()?.isOpen() ?? false;
                        }
                    } catch {
                        return false;
                    }
                    return false;
                };

                try {
                    // 1. Recuperação de Memórias de Longo Prazo e Semântica (Fase 4 & 6)
                    let relevantMemories: Memory[] = [];
                    if (this.memoryRepository && input.userMessage) {
                        try {
                            let queryVector: number[] | undefined;
                            if (this.embeddingProvider) {
                                try {
                                    queryVector = await this.embeddingProvider.generateEmbedding(input.userMessage);
                                } catch (embErr) {
                                    log.warn({ err: embErr }, 'Falha ao gerar embedding da mensagem do usuário. Usando busca textual.');
                                }
                            }

                            relevantMemories = await withSpan(
                                'agent.long_term_memory.search',
                                {
                                    attributes: {
                                        'app.tenant_id': input.tenantId,
                                        'app.workspace_id': input.workspaceId,
                                        'agent.has_vector': !!queryVector,
                                    },
                                },
                                async () => this.memoryRepository!.searchRelevant({
                                    tenantId: input.tenantId,
                                    workspaceId: input.workspaceId,
                                    query: input.userMessage,
                                    vector: queryVector,
                                    limit: 5,
                                })
                            );
                        } catch (memError) {
                            log.warn({ err: memError }, 'Falha ao buscar memórias de longo prazo. Continuando sem memórias.');
                        }
                    }

                    // 2. Context Assembly com Token Budgeting e Memórias Injetadas
                    const assembledContext = await withSpan(
                        'agent.context_assembly',
                        {
                            attributes: {
                                'agent.max_context_tokens': this.executionPolicy.maxContextTokens,
                                'agent.memories_count': relevantMemories.length,
                            },
                        },
                        async () => {
                            return this.contextAssembler.assemble(input.context, {
                                maxTokens: this.executionPolicy.maxContextTokens,
                                memories: relevantMemories,
                            });
                        }
                    );

                    run.memoriesInjected = relevantMemories.length;
                    const budget = this.executionPolicy.maxContextTokens;
                    const usedTokens = assembledContext.estimatedTokens ?? (assembledContext.messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0));
                    const utilization = budget > 0 ? Math.min(1, Math.round((usedTokens / budget) * 100) / 100) : 0;
                    run.contextUtilization = utilization;
                    agentContextUtilization.observe({ tenantId: input.tenantId }, utilization);

                    // Fallback imediato se o Circuit Breaker do MCP já estiver aberto antes da chamada
                    const cbInitiallyOpen = isCircuitBreakerOpen(input.mcpClient);
                    const initialTools = cbInitiallyOpen ? [] : input.tools;

                    if (cbInitiallyOpen) {
                        log.warn('Circuit Breaker do MCP está aberto. Ignorando ferramentas e respondendo com LLM puro.');
                        assembledContext.addMessage(
                            new Message(
                                crypto.randomUUID(),
                                'system',
                                'Aviso do Sistema: O serviço de ferramentas externas está temporariamente indisponível (circuito aberto). Por favor, responda com o seu conhecimento prévio informando que ações externas estão indisponíveis.'
                            )
                        );
                    }

                    // 3. Loop iterativo LLM ↔ MCP
                    let currentDecision = await withSpan(
                        'agent.llm_call',
                        {
                            attributes: {
                                'agent.iteration': 0,
                            },
                        },
                        async () => generateLlmWithTimeout(assembledContext, initialTools)
                    );
                    let iteration = 0;

                    while (
                        currentDecision.type === 'tool_call' &&
                        this.executionPolicy.shouldContinue(iteration) &&
                        !timeoutTriggered
                    ) {
                        iteration++;
                        run.iterations = iteration;

                        const toolCall = currentDecision.tool;
                        log.info({ iteration, tool: toolCall.name }, 'LLM solicitou chamada de ferramenta.');
                        agentToolCallsTotal.inc({ tenantId: input.tenantId, tool: toolCall.name });

                        const toolStartTime = Date.now();
                        let toolResult: any;
                        let toolError: string | undefined;
                        let circuitBreakerBroke = false;

                        try {
                            toolResult = await withSpan(
                                `agent.tool_execution:${toolCall.name}`,
                                {
                                    attributes: {
                                        'agent.tool_name': toolCall.name,
                                        'agent.iteration': iteration,
                                    },
                                },
                                async () => input.mcpClient.executeTool(toolCall)
                            );
                        } catch (err: any) {
                            toolError = err?.message ?? (typeof err === 'string' ? err : JSON.stringify(err));
                            log.error({ err, tool: toolCall.name }, 'Erro ao executar ferramenta via MCP.');
                            toolResult = { error: `Falha na execução da ferramenta: ${toolError}` };

                            if (err instanceof CircuitBreakerOpenError || err?.name === 'CircuitBreakerOpenError') {
                                circuitBreakerBroke = true;
                            }
                        }

                        const toolDurationMs = Date.now() - toolStartTime;
                        const record: ToolCallRecord = {
                            toolName: toolCall.name,
                            args: toolCall.parameters as Record<string, unknown>,
                            result: toolResult,
                            error: toolError,
                            durationMs: toolDurationMs
                        };
                        run.recordToolCall(record);

                        // Se o circuito abriu durante a chamada, interrompe ferramentas e faz fallback
                        if (circuitBreakerBroke) {
                            log.warn('Circuit Breaker abriu durante execução de tool. Efetuando fallback sem ferramentas.');
                            assembledContext.addMessage(
                                new Message(
                                    crypto.randomUUID(),
                                    'system',
                                    'Aviso do Sistema: O serviço de ferramentas externas ficou indisponível (circuito aberto). Conclua a resposta com as informações disponíveis.'
                                )
                            );
                            const fallbackDecision = await withSpan(
                                'agent.llm_call:circuit_breaker_fallback',
                                async () => generateLlmWithTimeout(assembledContext, [])
                            );
                            finalResponseText = fallbackDecision.type === 'text'
                                ? fallbackDecision.content
                                : 'O serviço externo está temporariamente indisponível.';
                            status = 'completed';
                            break;
                        }

                        // Adiciona o resultado da ferramenta ao contexto para a próxima iteração
                        assembledContext.addMessage(
                            new Message(crypto.randomUUID(), 'system', JSON.stringify(toolResult))
                        );

                        if (timeoutTriggered) {
                            break;
                        }

                        currentDecision = await withSpan(
                            'agent.llm_call',
                            {
                                attributes: {
                                    'agent.iteration': iteration,
                                },
                            },
                            async () => generateLlmWithTimeout(assembledContext, input.tools)
                        );
                    }

                    // 4. Resolução da resposta final, timeout global ou fallback de iterações
                    if (timeoutTriggered) {
                        log.warn('Execução do AgentHarness abortada por atingir timeout global.');
                        status = 'failed';
                        finalResponseText = finalResponseText || 'Tempo limite de execução atingido. A operação foi interrompida.';
                    } else if (finalResponseText) {
                        // já definido pelo fallback de circuit breaker
                    } else if (currentDecision.type === 'text') {
                        finalResponseText = currentDecision.content;
                        status = 'completed';
                    } else if (iteration >= this.executionPolicy.maxIterations) {
                        log.warn({ maxIterations: this.executionPolicy.maxIterations }, 'Limite de iterações atingido no Harness.');
                        status = 'max_iterations';
                        
                        assembledContext.addMessage(
                            new Message(
                                crypto.randomUUID(),
                                'system',
                                'Limite de chamadas de ferramentas atingido. Resuma as informações coletadas e responda ao usuário.'
                            )
                        );

                        const fallback = await withSpan(
                            'agent.llm_call:fallback',
                            async () => generateLlmWithTimeout(assembledContext, [])
                        );
                        finalResponseText = fallback.type === 'text'
                            ? fallback.content
                            : 'Desculpe, não consegui completar a análise no momento.';
                    }

                    run.finalResponse = finalResponseText;
                    run.finish(status);
                    rootSpan.setAttribute('agent.status', status);
                    rootSpan.setAttribute('agent.iterations', run.iterations);
                    rootSpan.setAttribute('agent.total_tokens', run.totalTokens);
                    rootSpan.setAttribute('agent.cost_usd', run.costUsd);

                    // 5. Salva o contexto atualizado na Short-Term Memory (Redis)
                    if (this.shortTermMemory && finalResponseText) {
                        assembledContext.addMessage(
                            new Message(crypto.randomUUID(), 'assistant', finalResponseText)
                        );
                        await withSpan(
                            'agent.short_term_memory.save',
                            async () => {
                                await this.shortTermMemory!.set(
                                    input.workspaceId,
                                    input.threadId,
                                    assembledContext.messages
                                );
                            }
                        );
                    }

                    // 6. Promoção Assíncrona de Memória (BullMQ) - Não bloqueia resposta ao usuário
                    if (this.queueService && finalResponseText && status === 'completed') {
                        const messagesPayload = assembledContext.messages.map(m => ({
                            role: m.role,
                            content: m.content,
                        }));

                        this.queueService.dispatchMemoryPromotion(
                            input.tenantId,
                            input.workspaceId,
                            input.threadId,
                            messagesPayload
                        ).catch(err => {
                            log.error({ err }, 'Erro ao enfileirar job de promoção de memória.');
                        });
                    }

                    // 7. Persistência do AgentRun no MongoDB
                    if (this.agentRunRepository) {
                        await this.agentRunRepository.save(run).catch(err => {
                            log.error({ err, runId }, 'Erro ao persistir AgentRun.');
                        });
                    }

                    // 8. Auto-Avaliação Assíncrona (BullMQ)
                    const isSelfEvalEnabled = process.env.SELF_EVALUATION_ENABLED !== 'false';
                    const durationMs = Date.now() - startTime;
                    if (this.queueService && typeof this.queueService.dispatchEvaluation === 'function' && finalResponseText && status === 'completed' && isSelfEvalEnabled) {
                        this.queueService.dispatchEvaluation(
                            run.id,
                            input.tenantId,
                            input.workspaceId,
                            {
                                threadId: input.threadId,
                                userMessage: input.userMessage,
                                finalResponse: finalResponseText,
                                iterations: run.iterations,
                                toolCalls: run.toolCalls,
                                llmCalls: run.llmCalls,
                                totalTokens: run.totalTokens,
                                costUsd: run.costUsd,
                                durationMs,
                                memoriesInjected: run.memoriesInjected,
                                agentVersion: run.agentVersion,
                            }
                        ).catch(err => {
                            log.error({ err, runId }, 'Erro ao enfileirar job de auto-avaliação.');
                        });
                    }

                    // 9. Métricas do Prometheus
                    const durationSeconds = durationMs / 1000;
                    agentRunsTotal.inc({ tenantId: input.tenantId, status });
                    agentRunDurationSeconds.observe({ tenantId: input.tenantId, status }, durationSeconds);

                    log.info({ durationMs, iterations: run.iterations, status }, 'Execução do Agent Harness concluída.');

                    return {
                        runId,
                        response: finalResponseText,
                        iterations: run.iterations,
                        toolCalls: run.toolCalls,
                        status,
                        durationMs
                    };
                } catch (error: any) {
                    const durationMs = Date.now() - startTime;
                    const errorMessage = error?.message ?? String(error);
                    run.finish('failed', errorMessage);
                    rootSpan.setAttribute('agent.status', 'failed');
                    rootSpan.setAttribute('agent.error', errorMessage);

                    if (this.agentRunRepository) {
                        await this.agentRunRepository.save(run).catch(err => {
                            log.error({ err, runId }, 'Erro ao persistir AgentRun com falha.');
                        });
                    }

                    log.error({ err: error, durationMs }, 'Erro durante a execução do Agent Harness.');

                    agentRunsTotal.inc({ tenantId: input.tenantId, status: 'failed' });
                    agentRunsFailedTotal.inc({ tenantId: input.tenantId, reason: errorMessage });
                    agentRunDurationSeconds.observe({ tenantId: input.tenantId, status: 'failed' }, durationMs / 1000);

                    return {
                        runId,
                        response: 'Ocorreu um erro ao processar sua solicitação.',
                        iterations: run.iterations,
                        toolCalls: run.toolCalls,
                        status: 'failed',
                        durationMs,
                        error: errorMessage
                    };
                } finally {
                    clearTimeout(globalTimeoutTimer);
                }
            }
        );
    }
}
