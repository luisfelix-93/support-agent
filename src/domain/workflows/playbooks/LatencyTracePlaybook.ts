import type { IInvestigationPlaybook, PlaybookDomain } from "../IInvestigationPlaybook.js";
import type { ChatContext } from "../../ChatContext.js";

export class LatencyTracePlaybook implements IInvestigationPlaybook {
    public readonly id = 'latency-trace';
    public readonly name = 'Latency & Distributed Tracing Playbook';
    public readonly domain: PlaybookDomain = 'latency';
    public readonly description = 'Investigação especializada de alta latência, degradação de tempo de resposta e gargalos em spans de traces distribuídos.';

    private readonly triggers: RegExp[] = [
        /lat[êe]ncia/i,
        /lento/i,
        /lentid[ãa]o/i,
        /timeout/i,
        /demorando/i,
        /tempo\s*de\s*resposta/i,
        /gargalo/i,
        /p95/i,
        /p99/i,
        /lag/i,
        /slow/i,
        /slowness/i,
        /tempo\s*limite\s*esgotado/i,
    ];

    matches(userMessage: string, context?: ChatContext): boolean {
        if (!userMessage) return false;

        if (this.triggers.some(regex => regex.test(userMessage))) {
            return true;
        }

        if (context && context.messages && context.messages.length > 0) {
            const recent = context.messages.slice(-3);
            return recent.some(m => m.role === 'user' && this.triggers.some(regex => regex.test(m.content)));
        }

        return false;
    }

    getInvestigationPrompt(): string {
        return `[DIRETRIZES DO PLAYBOOK: LATENCY & DISTRIBUTED TRACING]
- OBJETIVO: Diagnosticar degradação de performance, percentis de tempo de resposta anômalos e timeouts.
- PASSOS DE INVESTIGAÇÃO:
  1. Consulte métricas de latência no Prometheus (ex: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))).
  2. Inspecione traces distribuídos no Grafana Tempo (ex: tempo_query_trace, query_trace) para requisições com duração superior ao baseline.
  3. Analise a árvore de spans para isolar o componente que mais consumiu tempo (ex: chamada RPC downstream, query de banco lenta, chamada a parceiro externo ou lock).
  4. Verifique se houve deploys ou alterações de configuração recentes no período em que a latência começou a subir.
  5. Formule a hipótese de causa raiz e recomende ações de otimização/mitigação, sintetizando no Resumo Executivo da Sessão.`;
    }

    getRecommendedTools(): string[] {
        return [
            'tempo_query_trace',
            'query_trace',
            'prometheus_query',
            'query_metrics',
            'get_recent_deployments',
        ];
    }
}
