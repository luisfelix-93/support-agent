import { describe, it, expect, beforeEach } from 'vitest';
import { DatabasePlaybook } from './DatabasePlaybook.js';
import { ChatContext } from '../../../domain/ChatContext.js';
import { Message } from '../../../domain/Message.js';

describe('DatabasePlaybook', () => {
    let playbook: DatabasePlaybook;

    beforeEach(() => {
        playbook = new DatabasePlaybook();
    });

    it('deve possuir identificador e domínio corretos', () => {
        expect(playbook.id).toBe('database');
        expect(playbook.domain).toBe('database');
        expect(playbook.name).toBe('Database & Connection Pool Playbook');
        expect(playbook.getRecommendedTools()).toContain('query_db_metrics');
        expect(playbook.getRecommendedTools()).toContain('query_slow_queries');
    });

    it('deve disparar matches para termos de pool de conexões, slow queries e locks', () => {
        expect(playbook.matches('O connection pool do Postgres está esgotado')).toBe(true);
        expect(playbook.matches('Estamos enfrentando timeout de conexão com o banco de dados')).toBe(true);
        expect(playbook.matches('Detectamos uma slow query travando as requisições')).toBe(true);
        expect(playbook.matches('Houve um deadlock em transações concorrentes')).toBe(true);
        expect(playbook.matches('Atingimos o limite de max_connections no MySQL')).toBe(true);
    });

    it('não deve disparar matches para mensagens sem relação com banco de dados', () => {
        expect(playbook.matches('Como altero a logo da empresa?')).toBe(false);
        expect(playbook.matches('O Slack está integrado corretamente?')).toBe(false);
        expect(playbook.matches('')).toBe(false);
    });

    it('deve detectar gatilhos no histórico recente do contexto', () => {
        const context = new ChatContext('thread-db', 'ws-1', [
            new Message('m-1', 'user', 'A aplicação não consegue conectar no banco de dados'),
            new Message('m-2', 'assistant', 'Qual é a mensagem de erro retornada?'),
        ]);

        expect(playbook.matches('Diz que todas as conexões estão ocupadas', context)).toBe(true);
    });

    it('deve fornecer prompt de investigação cobrindo métricas de conexão e locks', () => {
        const prompt = playbook.getInvestigationPrompt();
        expect(prompt).toContain('[DIRETRIZES DO PLAYBOOK: DATABASE & CONNECTION POOL]');
        expect(prompt).toContain('query_db_metrics');
        expect(prompt).toContain('slow_queries');
        expect(prompt).toContain('table locks');
    });
});
