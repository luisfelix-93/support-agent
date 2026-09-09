import { describe, it, expect, beforeEach } from 'vitest';
import { KubernetesPlaybook } from './KubernetesPlaybook.js';
import { ChatContext } from '../../../domain/ChatContext.js';
import { Message } from '../../../domain/Message.js';

describe('KubernetesPlaybook', () => {
    let playbook: KubernetesPlaybook;

    beforeEach(() => {
        playbook = new KubernetesPlaybook();
    });

    it('deve possuir identificador e domínio corretos', () => {
        expect(playbook.id).toBe('kubernetes');
        expect(playbook.domain).toBe('kubernetes');
        expect(playbook.name).toBe('Kubernetes & Infrastructure Playbook');
        expect(playbook.getRecommendedTools()).toContain('get_pod_status');
        expect(playbook.getRecommendedTools()).toContain('get_cluster_events');
    });

    it('deve disparar matches para termos de pods, CrashLoopBackOff e OOMKilled', () => {
        expect(playbook.matches('O pod do worker está em CrashLoopBackOff')).toBe(true);
        expect(playbook.matches('Nosso deployment no k8s caiu com OOMKilled')).toBe(true);
        expect(playbook.matches('Vários pods reiniciando no namespace prod')).toBe(true);
        expect(playbook.matches('Falha na liveness probe no cluster kubernetes')).toBe(true);
        expect(playbook.matches('Container caiu com erro no deployment')).toBe(true);
    });

    it('não deve disparar matches para mensagens normais sem contexto de infraestrutura', () => {
        expect(playbook.matches('Qual é a chave de API cadastrada?')).toBe(false);
        expect(playbook.matches('Gostaria de cadastrar um novo usuário')).toBe(false);
        expect(playbook.matches('')).toBe(false);
    });

    it('deve detectar gatilhos no histórico recente do contexto', () => {
        const context = new ChatContext('thread-k8s', 'ws-1', [
            new Message('m-1', 'user', 'Tivemos um problema com os pods de pagamento'),
            new Message('m-2', 'assistant', 'Eles estão com status de erro?'),
        ]);

        expect(playbook.matches('Sim, estão reiniciando sem parar', context)).toBe(true);
    });

    it('deve fornecer prompt de investigação com diretrizes para pods, eventos e limits', () => {
        const prompt = playbook.getInvestigationPrompt();
        expect(prompt).toContain('[DIRETRIZES DO PLAYBOOK: KUBERNETES & INFRASTRUCTURE]');
        expect(prompt).toContain('get_pod_status');
        expect(prompt).toContain('OOMKilled');
        expect(prompt).toContain('limits.memory');
    });
});
