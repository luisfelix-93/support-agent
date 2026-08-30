import crypto from "crypto";
import type { IAgentHarness, AgentRunInput, AgentRunResult } from "../domain/ports/IAgentHarness.js";
import type { IShortTermMemory } from "../domain/ports/IShortTermMemory.js";
import type { IContextAssembler } from "../domain/ports/IContextAssembler.js";
import type { IMemoryRepository } from "../domain/ports/IMemoryRepository.js";
import type { IQueueService } from "../domain/ports/IQueueService.js";
import type { Memory } from "../domain/Memory.js";
import { AgentRun, type ToolCallRecord } from "../domain/AgentRun.js";
import { Message } from "../domain/Message.js";
import { ExecutionPolicy } from "./ExecutionPolicy.js";
import { logger } from "../config/logger.js";
import {
    agentRunsTotal,
    agentRunsFailedTotal,
    agentRunDurationSeconds,
    agentToolCallsTotal
} from "../infrastructure/metrics/AgentMetrics.js";
import { withSpan } from "../infrastructure/tracing/TracerProvider.js";

const baseLog = logger.child({ module: 'AgentHarness' });

export class AgentHarness implements IAgentHarness {
    constructor(
        private readonly contextAssembler: IContextAssembler,
        private readonly shortTermMemory?: IShortTermMemory,
        private readonly executionPolicy: ExecutionPolicy = new ExecutionPolicy(),
        private readonly memoryRepository?: IMemoryRepository,
        private readonly queueService?: IQueueService
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

                let finalResponseText = '';
                let status: 'completed' | 'failed' | 'max_iterations' = 'completed';

                try {
                    // 1. Recuperação de Memórias de Longo Prazo (Fase 4 & 6)
                    let relevantMemories: Memory[] = [];
                    if (this.memoryRepository && input.userMessage) {
                        try {
                            relevantMemories = await withSpan(
                                'agent.long_term_memory.search',
                                {
                                    attributes: {
                                        'app.tenant_id': input.tenantId,
                                        'app.workspace_id': input.workspaceId,
                                    },
                                },
                                async () => this.memoryRepository!.searchRelevant({
                                    tenantId: input.tenantId,
                                    workspaceId: input.workspaceId,
                                    query: input.userMessage,
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

                    // 3. Loop iterativo LLM ↔ MCP
                    let currentDecision = await withSpan(
                        'agent.llm_call',
                        {
                            attributes: {
                                'agent.iteration': 0,
                            },
                        },
                        async () => input.llmProvider.generateResponse(assembledContext, input.tools)
                    );
                    let iteration = 0;

                    while (
                        currentDecision.type === 'tool_call' &&
                        this.executionPolicy.shouldContinue(iteration)
                    ) {
                        iteration++;
                        run.iterations = iteration;

                        const toolCall = currentDecision.tool;
                        log.info({ iteration, tool: toolCall.name }, 'LLM solicitou chamada de ferramenta.');
                        agentToolCallsTotal.inc({ tenantId: input.tenantId, tool: toolCall.name });

                        const toolStartTime = Date.now();
                        let toolResult: any;
                        let toolError: string | undefined;

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

                        // Adiciona o resultado da ferramenta ao contexto para a próxima iteração
                        assembledContext.addMessage(
                            new Message(crypto.randomUUID(), 'system', JSON.stringify(toolResult))
                        );

                        currentDecision = await withSpan(
                            'agent.llm_call',
                            {
                                attributes: {
                                    'agent.iteration': iteration,
                                },
                            },
                            async () => input.llmProvider.generateResponse(assembledContext, input.tools)
                        );
                    }

                    // 4. Resolução da resposta final ou fallback de iterações
                    if (currentDecision.type === 'text') {
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
                            async () => input.llmProvider.generateResponse(assembledContext, [])
                        );
                        finalResponseText = fallback.type === 'text'
                            ? fallback.content
                            : 'Desculpe, não consegui completar a análise no momento.';
                    }

                    run.finish(status);
                    rootSpan.setAttribute('agent.status', status);
                    rootSpan.setAttribute('agent.iterations', run.iterations);

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

                    // 7. Métricas do Prometheus
                    const durationMs = Date.now() - startTime;
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
                }
            }
        );
    }
}
