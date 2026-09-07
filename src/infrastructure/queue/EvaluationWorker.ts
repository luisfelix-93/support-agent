import crypto from "crypto";
import { Worker, type Job } from "bullmq";
import { SpanKind } from "@opentelemetry/api";
import type { ITenantRepository } from "../../domain/ports/ITenantRepository.js";
import type { IEvaluationRepository } from "../../domain/ports/IEvaluationRepository.js";
import { LLMFactory } from "../llm/LLMFactory.js";
import { ChatContext } from "../../domain/ChatContext.js";
import { Message } from "../../domain/Message.js";
import { SelfEvaluationPrompt } from "../../evaluation/SelfEvaluationPrompt.js";
import { calculateCompositeScore } from "../../evaluation/ScoreCalculator.js";
import { EvaluationResult, type SelfEvalScores, type PassiveMetrics } from "../../domain/EvaluationResult.js";
import type { ToolCallRecord } from "../../domain/AgentRun.js";
import type { LLMCallRecord } from "../../domain/LLMCallRecord.js";
import { logger } from "../../config/logger.js";
import { extractTraceContext } from "../tracing/TraceContext.js";
import { withContext, withSpan } from "../tracing/TracerProvider.js";
import {
    agentEvaluationCompositeScore,
    agentEvaluationConfidenceAvg,
    agentEvaluationHallucinationAvg,
    agentEvaluationRunsEvaluated,
} from "../metrics/EvaluationMetrics.js";

const log = logger.child({ module: 'EvaluationWorker' });

export interface EvaluationJobData {
    runId: string;
    tenantId: string;
    workspaceId: string;
    threadId?: string;
    userMessage?: string;
    finalResponse?: string;
    iterations: number;
    toolCalls: ToolCallRecord[];
    llmCalls?: LLMCallRecord[];
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    memoriesInjected: number;
    contextUtilization?: number;
    agentVersion: string;
    traceContext?: Record<string, string>;
}

export class EvaluationWorker {
    private worker: Worker | null = null;

    constructor(
        private readonly redisConnection: any,
        private readonly tenantRepository: ITenantRepository,
        private readonly evaluationRepository: IEvaluationRepository,
        private readonly queueName: string = 'agent-evaluation'
    ) {}

    start(): void {
        if (this.worker) {
            log.warn('Worker de auto-avaliação já está em execução.');
            return;
        }

        log.info({ queueName: this.queueName }, 'Iniciando worker de auto-avaliação do agente.');

        this.worker = new Worker(
            this.queueName,
            async (job: Job<EvaluationJobData>) => {
                const {
                    runId,
                    tenantId,
                    workspaceId,
                    userMessage,
                    finalResponse,
                    iterations,
                    toolCalls,
                    totalInputTokens,
                    totalOutputTokens,
                    totalTokens,
                    costUsd,
                    durationMs,
                    memoriesInjected,
                    contextUtilization,
                    agentVersion,
                    traceContext,
                } = job.data;

                const parentContext = extractTraceContext(traceContext);

                await withContext(parentContext, async () => {
                    await withSpan(
                        'bullmq.process_evaluation',
                        {
                            kind: SpanKind.CONSUMER,
                            attributes: {
                                'messaging.system': 'bullmq',
                                'messaging.destination': this.queueName,
                                'messaging.job_id': job.id,
                                'app.run_id': runId,
                                'app.tenant_id': tenantId,
                                'app.workspace_id': workspaceId,
                            },
                        },
                        async () => {
                            log.info({ jobId: job.id, runId, tenantId, workspaceId }, 'Iniciando processamento de auto-avaliação.');

                            // 1. Carrega tenant para instanciar provider LLM correspondente
                            const tenant = await this.tenantRepository.findByWorkspaceId(workspaceId);
                            if (!tenant || !tenant.isActive) {
                                log.warn({ workspaceId, tenantId }, 'Tenant não encontrado ou inativo para auto-avaliação. Pulando job.');
                                return;
                            }

                            // 2. Cria provedor LLM a partir da configuração do tenant
                            const llmProvider = LLMFactory.create(tenant.llmConfig);

                            // 3. Monta prompt de auto-avaliação
                            const promptText = SelfEvaluationPrompt.build({
                                userMessage,
                                toolCalls,
                                finalResponse,
                                memoriesUsed: memoriesInjected,
                            });

                            const evalContext = new ChatContext(`eval-${runId}`, workspaceId);
                            evalContext.addMessage(new Message(crypto.randomUUID(), 'user', promptText));

                            // 4. Invoca LLM com tentativa e suporte a retry em caso de JSON malformado
                            let selfEvalScores = await this.evaluateWithRetry(llmProvider, evalContext, promptText);

                            // 5. Consolida métricas passivas
                            const calls = toolCalls || [];
                            const toolCallsTotal = calls.length;
                            const toolCallsFailed = calls.filter(t => !!t.error).length;
                            const toolSuccessRate = toolCallsTotal > 0
                                ? (toolCallsTotal - toolCallsFailed) / toolCallsTotal
                                : 1.0;

                            const passive: PassiveMetrics = {
                                durationMs,
                                iterations,
                                toolCallsTotal,
                                toolCallsFailed,
                                toolSuccessRate,
                                totalInputTokens: totalInputTokens ?? 0,
                                totalOutputTokens: totalOutputTokens ?? 0,
                                totalTokens,
                                costUsd,
                                memoriesInjected,
                                contextUtilization: contextUtilization ?? 0,
                            };

                            // 6. Calcula Composite Score ponderado
                            const compositeScore = calculateCompositeScore(passive, selfEvalScores);

                            // 7. Persiste o EvaluationResult no MongoDB
                            const evaluationResult = new EvaluationResult(
                                runId,
                                tenantId,
                                workspaceId,
                                agentVersion || '1.0.0',
                                passive,
                                selfEvalScores,
                                compositeScore,
                                new Date()
                            );

                            await this.evaluationRepository.save(evaluationResult);

                            const versionLabel = agentVersion || '1.0.0';
                            agentEvaluationCompositeScore.set({ tenantId, version: versionLabel }, compositeScore);
                            agentEvaluationConfidenceAvg.set({ tenantId, version: versionLabel }, selfEvalScores.confidence);
                            agentEvaluationHallucinationAvg.set({ tenantId, version: versionLabel }, selfEvalScores.hallucinationRisk);
                            agentEvaluationRunsEvaluated.inc({ tenantId, version: versionLabel });

                            log.info(
                                {
                                    runId,
                                    tenantId,
                                    compositeScore,
                                    confidence: selfEvalScores.confidence,
                                    hallucinationRisk: selfEvalScores.hallucinationRisk,
                                    completeness: selfEvalScores.completeness,
                                },
                                'Auto-avaliação concluída e persistida com sucesso.'
                            );
                        }
                    );
                });
            },
            {
                connection: this.redisConnection,
                concurrency: 5,
            }
        );

        this.worker.on('failed', (job, err) => {
            log.error({ jobId: job?.id, err }, 'Job de auto-avaliação falhou no processamento.');
        });

        this.worker.on('error', (err) => {
            log.error({ err }, 'Erro inesperado no EvaluationWorker.');
        });
    }

    /**
     * Executa a chamada ao LLM e efetua retry corretivo caso o JSON retornado seja malformado.
     */
    private async evaluateWithRetry(
        llmProvider: any,
        evalContext: ChatContext,
        originalPrompt: string
    ): Promise<SelfEvalScores> {
        try {
            const initialResponse = await llmProvider.generateResponse(evalContext);
            const initialContent = initialResponse.type === 'text' ? initialResponse.content : '';

            const parsed = this.parseJsonScores(initialContent);
            if (parsed) {
                return parsed;
            }

            log.warn('Resposta inicial do LLM de avaliação não contém JSON válido. Tentando prompt corretivo.');

            // Tentativa única de correção
            const correctionPrompt = SelfEvaluationPrompt.buildCorrectionPrompt(initialContent);
            const retryContext = new ChatContext(evalContext.threadID + '-retry', evalContext.workspaceId);
            retryContext.addMessage(new Message(crypto.randomUUID(), 'user', originalPrompt));
            retryContext.addMessage(new Message(crypto.randomUUID(), 'assistant', initialContent));
            retryContext.addMessage(new Message(crypto.randomUUID(), 'user', correctionPrompt));

            const retryResponse = await llmProvider.generateResponse(retryContext);
            const retryContent = retryResponse.type === 'text' ? retryResponse.content : '';

            const retryParsed = this.parseJsonScores(retryContent);
            if (retryParsed) {
                return retryParsed;
            }

            log.error('Retry de auto-avaliação também falhou ao retornar JSON válido. Utilizando scores conservadores padrão.');
            return this.defaultFallbackScores('Falha no parsing de JSON do avaliador.');
        } catch (error) {
            log.error({ err: error }, 'Erro ao invocar LLM para auto-avaliação.');
            return this.defaultFallbackScores('Erro na chamada do modelo de avaliação.');
        }
    }

    /**
     * Extrai e valida o JSON com os 5 campos de score.
     */
    private parseJsonScores(raw: string): SelfEvalScores | null {
        if (!raw) return null;

        let clean = raw.trim();
        // Remove delimitadores markdown como ```json ... ``` se presentes
        if (clean.startsWith('```')) {
            clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }

        // Tenta encontrar bloco json {...}
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        try {
            const data = JSON.parse(jsonMatch[0]);
            if (
                typeof data.confidence === 'number' &&
                typeof data.hallucinationRisk === 'number' &&
                typeof data.contextRelevance === 'number' &&
                typeof data.completeness === 'number' &&
                typeof data.toolSelectionQuality === 'number'
            ) {
                return {
                    confidence: data.confidence,
                    hallucinationRisk: data.hallucinationRisk,
                    contextRelevance: data.contextRelevance,
                    completeness: data.completeness,
                    toolSelectionQuality: data.toolSelectionQuality,
                    reasoning: typeof data.reasoning === 'string' ? data.reasoning : undefined,
                };
            }
        } catch {
            return null;
        }

        return null;
    }

    private defaultFallbackScores(reason: string): SelfEvalScores {
        return {
            confidence: 0.5,
            hallucinationRisk: 0.5,
            contextRelevance: 0.5,
            completeness: 0.5,
            toolSelectionQuality: 0.5,
            reasoning: `Fallback: ${reason}`,
        };
    }

    async stop(): Promise<void> {
        if (this.worker) {
            log.info('Finalizando EvaluationWorker.');
            await this.worker.close();
            this.worker = null;
        }
    }
}
