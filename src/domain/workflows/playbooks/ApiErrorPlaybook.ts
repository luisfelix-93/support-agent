import type { IInvestigationPlaybook, PlaybookDomain } from "../IInvestigationPlaybook.js";
import type { ChatContext } from "../../ChatContext.js";

export class ApiErrorPlaybook implements IInvestigationPlaybook {
    public readonly id = 'api-error';
    public readonly name = 'API & Service Errors Playbook';
    public readonly domain: PlaybookDomain = 'api';
    public readonly description = 'Investigação especializada de falhas, exceptions e status HTTP 5xx em APIs e microsserviços.';

    private readonly triggers: RegExp[] = [
        /\b50[0-4]\b/i,
        /\b5xx\b/i,
        /http\s*5\d\d/i,
        /internal\s*server\s*error/i,
        /bad\s*gateway/i,
        /service\s*unavailable/i,
        /gateway\s*timeout/i,
        /erro.*api/i,
        /api.*erro/i,
        /falha.*api/i,
        /endpoint.*falh/i,
        /exception/i,
        /crash.*api/i,
        /servi[çc]o.*inst[aá]vel/i,
        /falha.*servi[çc]o/i,
        /erro\s*500/i,
    ];

    matches(userMessage: string, context?: ChatContext): boolean {
        if (!userMessage) return false;

        if (this.triggers.some(regex => regex.test(userMessage))) {
            return true;
        }

        // Checagem em histórico recente do contexto se houver
        if (context && context.messages && context.messages.length > 0) {
            const recent = context.messages.slice(-3);
            return recent.some(m => m.role === 'user' && this.triggers.some(regex => regex.test(m.content)));
        }

        return false;
    }

    getInvestigationPrompt(): string {
        return `[DIRETRIZES DO PLAYBOOK: API & SERVICE ERRORS]
- OBJETIVO: Diagnosticar a causa raiz de erros HTTP 5xx, exceções e instabilidade em APIs.
- PASSOS DE INVESTIGAÇÃO:
  1. Identifique o microsserviço/endpoint reportado na mensagem.
  2. Execute ferramentas de logs (ex: query_logs, loki_query_logs) filtrando por severidade ERROR/FATAL e pelo nome do serviço.
  3. Execute ferramentas de métricas (ex: prometheus_query, query_metrics) para verificar taxa de requisições e taxa de erros 5xx (ex: sum(rate(http_requests_total{status=~"5.."}[5m]))).
  4. Correlacione o momento em que os logs de erro começaram com o pico de métricas 5xx para delimitar o timestamp de início da falha.
  5. Formule a hipótese de causa raiz (ex: NullPointerException, falha em dependência externa, erro de banco ou payload inválido).
  6. Recomende correções técnicas claras e gere o Resumo Executivo da Sessão.`;
    }

    getRecommendedTools(): string[] {
        return [
            'loki_query_logs',
            'query_logs',
            'prometheus_query',
            'query_metrics',
        ];
    }
}
