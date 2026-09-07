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
