import { describe, it, expect, beforeEach } from 'vitest';
import { ApiErrorPlaybook } from './ApiErrorPlaybook.js';
import { ChatContext } from '../../../domain/ChatContext.js';
import { Message } from '../../../domain/Message.js';

describe('ApiErrorPlaybook', () => {
    let playbook: ApiErrorPlaybook;

    beforeEach(() => {
        playbook = new ApiErrorPlaybook();
    });

    it('deve possuir identificador e domínio corretos', () => {
        expect(playbook.id).toBe('api-error');
        expect(playbook.domain).toBe('api');
        expect(playbook.name).toBe('API & Service Errors Playbook');
        expect(playbook.getRecommendedTools()).toContain('loki_query_logs');
        expect(playbook.getRecommendedTools()).toContain('prometheus_query');
    });

    it('deve disparar matches para termos de erro 500 e exceções de API', () => {
        expect(playbook.matches('A API de pagamentos está retornando erro 500')).toBe(true);
        expect(playbook.matches('Estamos recebendo HTTP 502 Bad Gateway no gateway')).toBe(true);
        expect(playbook.matches('Endpoint /v1/checkout falhando com 503 Service Unavailable')).toBe(true);
        expect(playbook.matches('Houve uma unhandled exception no microsserviço de autenticação')).toBe(true);
        expect(playbook.matches('Serviço instável com muitas falhas 5xx')).toBe(true);
    });

    it('não deve disparar matches para mensagens normais sem indicação de erro', () => {
        expect(playbook.matches('Como faço para criar um novo usuário?')).toBe(false);
        expect(playbook.matches('Qual é a documentação do endpoint de login?')).toBe(false);
        expect(playbook.matches('Bom dia, tudo bem?')).toBe(false);
        expect(playbook.matches('')).toBe(false);
    });

    it('deve detectar gatilhos presentes no histórico recente do contexto', () => {
        const context = new ChatContext('thread-1', 'ws-1', [
            new Message('m-1', 'user', 'Nossa API começou a falhar com erro 500'),
            new Message('m-2', 'assistant', 'Poderia me dar mais detalhes?'),
        ]);

        expect(playbook.matches('Sim, acontece nas requisições do checkout', context)).toBe(true);
    });

    it('deve fornecer prompt de investigação com diretrizes estruturadas', () => {
        const prompt = playbook.getInvestigationPrompt();
        expect(prompt).toContain('[DIRETRIZES DO PLAYBOOK: API & SERVICE ERRORS]');
        expect(prompt).toContain('loki_query_logs');
        expect(prompt).toContain('5xx');
        expect(prompt).toContain('Resumo Executivo da Sessão');
    });
});
