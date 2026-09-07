import client from 'prom-client';
import { metricsRegister } from '../../config/metrics.js';

export const agentLlmTokensTotal = new client.Counter({
    name: 'agent_llm_tokens_total',
    help: 'Total de tokens consumidos por chamadas LLM do agente.',
    labelNames: ['tenantId', 'provider', 'model', 'direction'],
    registers: [metricsRegister],
});

export const agentRunCostUsd = new client.Counter({
    name: 'agent_run_cost_usd',
    help: 'Custo estimado em USD das execuções do agente.',
    labelNames: ['tenantId', 'provider', 'model'],
    registers: [metricsRegister],
});

export const agentContextUtilization = new client.Histogram({
    name: 'agent_context_utilization',
    help: 'Taxa de utilização do contexto (tokens usados / budget).',
    labelNames: ['tenantId'],
    buckets: [0.1, 0.25, 0.5, 0.75, 0.9, 1.0],
    registers: [metricsRegister],
});

export const agentEvaluationCompositeScore = new client.Gauge({
    name: 'agent_evaluation_composite_score',
    help: 'Último composite score avaliado para a versão do agente.',
    labelNames: ['tenantId', 'version'],
    registers: [metricsRegister],
});

export const agentEvaluationConfidenceAvg = new client.Gauge({
    name: 'agent_evaluation_confidence_avg',
    help: 'Último score de confiança avaliado para a versão do agente.',
    labelNames: ['tenantId', 'version'],
    registers: [metricsRegister],
});

export const agentEvaluationHallucinationAvg = new client.Gauge({
    name: 'agent_evaluation_hallucination_avg',
    help: 'Último score de risco de alucinação avaliado para a versão do agente.',
    labelNames: ['tenantId', 'version'],
    registers: [metricsRegister],
});

export const agentEvaluationRunsEvaluated = new client.Counter({
    name: 'agent_evaluation_runs_evaluated',
    help: 'Total de execuções avaliadas pelo EvaluationWorker.',
    labelNames: ['tenantId', 'version'],
    registers: [metricsRegister],
});

