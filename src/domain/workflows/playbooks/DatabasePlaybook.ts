import type { IInvestigationPlaybook, PlaybookDomain } from "../IInvestigationPlaybook.js";
import type { ChatContext } from "../../ChatContext.js";

export class DatabasePlaybook implements IInvestigationPlaybook {
    public readonly id = 'database';
    public readonly name = 'Database & Connection Pool Playbook';
    public readonly domain: PlaybookDomain = 'database';
    public readonly description = 'Investigação especializada de contenção de conexões, pool esgotado, slow queries, locks e deadlocks em bancos de dados.';

    private readonly triggers: RegExp[] = [
        /banco.*dados/i,
        /database/i,
        /postgres/i,
        /mysql/i,
        /mongo/i,
        /connection.*pool/i,
        /pool.*conex[ãa]o/i,
        /max_connections/i,
        /slow.*quer/i,
        /query.*lent/i,
        /\block\b/i,
        /\blocks\b/i,
        /deadlock/i,
        /table.*lock/i,
        /timeout.*conex[ãa]o/i,
        /conex[ãa]o.*banco/i,
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
        return `[DIRETRIZES DO PLAYBOOK: DATABASE & CONNECTION POOL]
- OBJETIVO: Diagnosticar gargalos de banco de dados, esgotamento de conexões, queries lentas e transações bloqueadas.
- PASSOS DE INVESTIGAÇÃO:
  1. Identifique o banco de dados e serviço que mantém o pool de conexões afetado.
  2. Execute ferramentas de métricas de banco (ex: query_db_metrics, get_connection_pool_status) para verificar conexões ativas vs capacidade máxima do pool.
  3. Execute ferramentas de consulta de queries lentas (ex: query_slow_queries) para identificar comandos SQL/NoSQL executando com duração excessiva.
  4. Inspecione a presença de table locks ou deadlocks bloqueando threads concorrentes (ex: get_db_locks).
  5. Formule a hipótese de causa raiz (ex: falta de índice em tabela volumosa, pool subdimensionado, transação aberta sem commit ou lock exclusivo).
  6. Recomende ações corretivas claras e gere o Resumo Executivo da Sessão.`;
    }

    getRecommendedTools(): string[] {
        return [
            'query_db_metrics',
            'query_slow_queries',
            'get_connection_pool_status',
            'get_db_locks',
        ];
    }
}
