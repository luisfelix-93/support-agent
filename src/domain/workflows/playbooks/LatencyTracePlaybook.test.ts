import { describe, it, expect, beforeEach } from 'vitest';
import { LatencyTracePlaybook } from './LatencyTracePlaybook.js';
import { ChatContext } from '../../../domain/ChatContext.js';
import { Message } from '../../../domain/Message.js';

describe('LatencyTracePlaybook', () => {
    let playbook: LatencyTracePlaybook;

    beforeEach(() => {
        playbook = new LatencyTracePlaybook();
    });

    it('deve possuir identificador e domínio corretos', () => {
        expect(playbook.id).toBe('latency-trace');
        expect(playbook.domain).toBe('latency');
        expect(playbook.name).toBe('Latency & Distributed Tracing Playbook');
        expect(playbook.getRecommendedTools()).toContain('tempo_query_trace');
        expect(playbook.getRecommendedTools()).toContain('prometheus_query');
    });

    it('deve disparar matches para termos de lentidão, latência e timeout', () => {
        expect(playbook.matches('O checkout está com alta latência nos últimos 10 minutos')).toBe(true);
        expect(playbook.matches('Os clientes estão reclamando que o site está muito lento')).toBe(true);
        expect(playbook.matches('Estamos tendo timeout nas chamadas ao serviço de cartões')).toBe(true);
        expect(playbook.matches('O p95 e p99 de tempo de resposta subiram drasticamente')).toBe(true);
        expect(playbook.matches('Há um gargalo evidente nas buscas de produtos')).toBe(true);
    });

    it('não deve disparar matches para mensagens normais sem indicação de lentidão', () => {
        expect(playbook.matches('Quantos usuários temos cadastrados?')).toBe(false);
        expect(playbook.matches('Como altero minha senha?')).toBe(false);
        expect(playbook.matches('')).toBe(false);
    });

    it('deve detectar menções de lentidão no histórico recente do contexto', () => {
        const context = new ChatContext('thread-2', 'ws-1', [
            new Message('m-1', 'user', 'O sistema está demorando muito para responder'),
            new Message('m-2', 'assistant', 'Qual endpoint específico você está testando?'),
        ]);

        expect(playbook.matches('O endpoint de consulta de pedidos', context)).toBe(true);
    });

    it('deve fornecer prompt de investigação cobrindo Tempo e Prometheus', () => {
        const prompt = playbook.getInvestigationPrompt();
        expect(prompt).toContain('[DIRETRIZES DO PLAYBOOK: LATENCY & DISTRIBUTED TRACING]');
        expect(prompt).toContain('tempo_query_trace');
        expect(prompt).toContain('Prometheus');
        expect(prompt).toContain('spans');
    });
});
