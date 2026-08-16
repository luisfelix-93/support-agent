import crypto from "crypto";
import type { IAgentHarness, AgentRunInput, AgentRunResult } from "../domain/ports/IAgentHarness.js";
import type { IShortTermMemory } from "../domain/ports/IShortTermMemory.js";
import type { IContextAssembler } from "../domain/ports/IContextAssembler.js";
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

const baseLog = logger.child({ module: 'AgentHarness' });

export class AgentHarness implements IAgentHarness {
    constructor(
        private readonly contextAssembler: IContextAssembler,
        private readonly shortTermMemory?: IShortTermMemory,
        private readonly executionPolicy: ExecutionPolicy = new ExecutionPolicy()
    ) {}

    async run(input: AgentRunInput): Promise<AgentRunResult> {
        const runId = crypto.randomUUID();
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
            // 1. Context Assembly com Token Budgeting
            const assembledContext = await this.contextAssembler.assemble(input.context, {
                maxTokens: this.executionPolicy.maxContextTokens
            });

            // 2. Loop iterativo LLM ↔ MCP
            let currentDecision = await input.llmProvider.generateResponse(assembledContext, input.tools);
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
                    toolResult = await input.mcpClient.executeTool(toolCall);
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

                currentDecision = await input.llmProvider.generateResponse(assembledContext, input.tools);
            }

            // 3. Resolução da resposta final ou fallback de iterações
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

                const fallback = await input.llmProvider.generateResponse(assembledContext, []);
                finalResponseText = fallback.type === 'text'
                    ? fallback.content
                    : 'Desculpe, não consegui completar a análise no momento.';
            }

            run.finish(status);

            // 4. Salva o contexto atualizado na Short-Term Memory (Redis)
            if (this.shortTermMemory && finalResponseText) {
                assembledContext.addMessage(
                    new Message(crypto.randomUUID(), 'assistant', finalResponseText)
                );
                await this.shortTermMemory.set(
                    input.workspaceId,
                    input.threadId,
                    assembledContext.messages
                );
            }

            // 5. Métricas do Prometheus
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
}
