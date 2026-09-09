import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvestigationEngine } from './InvestigationEngine.js';
import { PlaybookRegistry } from '../domain/workflows/PlaybookRegistry.js';
import type { IInvestigationPlaybook } from '../domain/workflows/IInvestigationPlaybook.js';

describe('InvestigationEngine', () => {
    let registry: PlaybookRegistry;
    let engine: InvestigationEngine;

    const mockPlaybook1: IInvestigationPlaybook = {
        id: 'api-error',
        name: 'API Error Playbook',
        domain: 'api',
        description: 'Diagnóstico de erros HTTP 5xx',
        matches: vi.fn((msg: string) => msg.includes('500') || msg.includes('erro')),
        getInvestigationPrompt: vi.fn().mockReturnValue('Instruções específicas para erros de API.'),
        getRecommendedTools: vi.fn().mockReturnValue(['query_logs', 'query_metrics']),
    };

    const mockPlaybook2: IInvestigationPlaybook = {
        id: 'database',
        name: 'Database Playbook',
        domain: 'database',
        description: 'Diagnóstico de problemas em banco de dados',
        matches: vi.fn((msg: string) => msg.includes('banco') || msg.includes('conexão')),
        getInvestigationPrompt: vi.fn().mockReturnValue('Instruções específicas para banco de dados.'),
        getRecommendedTools: vi.fn().mockReturnValue(['query_db_metrics']),
    };

    beforeEach(() => {
        registry = new PlaybookRegistry();
        registry.register(mockPlaybook1);
        registry.register(mockPlaybook2);
        engine = new InvestigationEngine(registry);
    });

    it('deve retornar null para mensagem vazia ou sem playbooks correspondentes (modo conversacional comum)', () => {
        expect(engine.evaluate('')).toBeNull();
        expect(engine.evaluate('   ')).toBeNull();

        const plan = engine.evaluate('Como funciona a documentação da API?');
        expect(plan).toBeNull();
    });

    it('deve retornar InvestigationPlan com playbooks consolidados quando houver correspondência', () => {
        const plan = engine.evaluate('O serviço de pagamentos está retornando erro 500 no banco');
        expect(plan).not.toBeNull();
        expect(plan!.isIncident).toBe(true);
        expect(plan!.playbookIds).toEqual(['api-error', 'database']);
        expect(plan!.recommendedTools).toContain('query_logs');
        expect(plan!.recommendedTools).toContain('query_metrics');
        expect(plan!.recommendedTools).toContain('query_db_metrics');

        expect(plan!.systemInstructions).toContain('[DIRETRIZ DE INVESTIGAÇÃO DE INCIDENTES SRE]');
        expect(plan!.systemInstructions).toContain('Playbooks ativos nesta sessão: api-error, database');
        expect(plan!.systemInstructions).toContain('RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)');
        expect(plan!.systemInstructions).toContain('Instruções específicas para erros de API.');
        expect(plan!.systemInstructions).toContain('Instruções específicas para banco de dados.');
    });

    it('deve retornar null no extractSessionSummary se o texto não contiver o cabeçalho de resumo', () => {
        const summary = engine.extractSessionSummary('Olá, o sistema foi verificado e não há anomalias.', 'run-1');
        expect(summary).toBeNull();
    });

    it('deve extrair SessionSummary estruturado a partir do texto formatado', () => {
        const responseText = `
Identifiquei a falha após analisar os dados.

═══════════════════════════════════════════════════════════
📋 RESUMO EXECUTIVO DE SESSÃO (SESSION SUMMARY)
═══════════════════════════════════════════════════════════
• Run ID: run-999
• Serviço / Componente: payment-service
• Janela do Incidente: 14:10 até 14:35
• Playbooks Ativados: api-error, database

🔍 EVIDÊNCIAS CONSOLIDADAS:
• Logs:
  - java.sql.SQLException: Connection pool exhausted
  - Timeout after 30000ms
• Métricas:
  - active_connections: 100/100
  - http_5xx_rate: 45 req/s

💡 HIPÓTESE DE CAUSA RAIZ (RCA):
Esgotamento do pool de conexões do PostgreSQL devido a transações longas sem commit no checkout.

🛠️ AÇÕES RECOMENDADAS:
1. Reiniciar pods para liberar conexões travadas
2. Ajustar max_connections e idle timeout no pool HikariCP
═══════════════════════════════════════════════════════════
        `;

        const summary = engine.extractSessionSummary(responseText, 'run-999', ['api-error', 'database']);
        expect(summary).not.toBeNull();
        expect(summary!.runId).toBe('run-999');
        expect(summary!.serviceName).toBe('payment-service');
        expect(summary!.incidentWindow?.start).toContain('14:10 até 14:35');
        expect(summary!.rootCauseHypothesis).toContain('Esgotamento do pool de conexões');
        expect(summary!.evidence.logs).toHaveLength(2);
        expect(summary!.evidence.logs[0]).toContain('Connection pool exhausted');
        expect(summary!.evidence.metrics).toHaveLength(2);
        expect(summary!.recommendedActions).toHaveLength(2);
        expect(summary!.recommendedActions[0]).toBe('Reiniciar pods para liberar conexões travadas');
        expect(summary!.playbooksInvolved).toEqual(['api-error', 'database']);
    });
});
