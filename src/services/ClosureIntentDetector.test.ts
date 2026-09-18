import { describe, it, expect, beforeEach } from 'vitest';
import { ClosureIntentDetector } from './ClosureIntentDetector.js';

describe('ClosureIntentDetector', () => {
    let detector: ClosureIntentDetector;

    beforeEach(() => {
        detector = new ClosureIntentDetector();
    });

    describe('Comandos e Frases Explícitas (Unconditional)', () => {
        const explicitCommands = [
            '/encerrar',
            '/close',
            '/finalizar',
            '/encerrar-sessao',
            '/concluir',
            'pode encerrar',
            'encerrar sessão',
            'fechar sessão',
            'fechar chamado',
            'análise concluída',
            'problema resolvido',
            'incidente resolvido',
            'pode encerrar a investigação',
        ];

        it.each(explicitCommands)('deve retornar CONFIRM_CLOSURE para o comando "%s" mesmo sem estar aguardando', (cmd) => {
            expect(detector.detectIntent(cmd, false)).toBe('CONFIRM_CLOSURE');
            expect(detector.detectIntent(cmd, true)).toBe('CONFIRM_CLOSURE');
        });

        it('deve desconsiderar case e acentos', () => {
            expect(detector.detectIntent('PODE ENCERRAR SESSÃO', false)).toBe('CONFIRM_CLOSURE');
            expect(detector.detectIntent('/FINALIZAR', false)).toBe('CONFIRM_CLOSURE');
            expect(detector.detectIntent('análise concluida', false)).toBe('CONFIRM_CLOSURE');
        });
    });

    describe('Respostas quando aguardando confirmação (isAwaitingConfirmation: true)', () => {
        const affirmativeAnswers = [
            'sim',
            'Sim',
            'SIM',
            'yes',
            's',
            'ok',
            'OK',
            'pode ser',
            'isso mesmo',
            'com certeza',
            'fechado',
            'confirmo',
            'pode fechar',
            'tudo certo',
            'concluído',
        ];

        it.each(affirmativeAnswers)('deve detectar CONFIRM_CLOSURE para a resposta afirmativa "%s"', (ans) => {
            expect(detector.detectIntent(ans, true)).toBe('CONFIRM_CLOSURE');
        });

        const negativeAnswers = [
            'não',
            'nao',
            'NÃO',
            'no',
            'ainda não',
            'ainda nao',
            'espere',
            'não encerre',
            'quero continuar',
            'continuar investigando',
            'tenho outra dúvida',
            'verifique também os logs do nginx',
            'e como está a latência do pod?',
        ];

        it.each(negativeAnswers)('deve detectar REJECT_CLOSURE para respostas negativas ou de continuidade "%s"', (ans) => {
            expect(detector.detectIntent(ans, true)).toBe('REJECT_CLOSURE');
        });
    });

    describe('Mensagens Neutras / Normais', () => {
        const neutralMessages = [
            'Como funciona o circuit breaker?',
            'O pod auth-service está com erro 500',
            'Liste as métricas de latência dos últimos 15 minutos',
            'Qual é a versão do cluster?',
        ];

        it.each(neutralMessages)('deve retornar NEUTRAL quando fora de confirmação para "%s"', (msg) => {
            expect(detector.detectIntent(msg, false)).toBe('NEUTRAL');
        });

        it('deve retornar NEUTRAL para string vazia ou espaços em branco', () => {
            expect(detector.detectIntent('', false)).toBe('NEUTRAL');
            expect(detector.detectIntent('   ', true)).toBe('NEUTRAL');
        });
    });
});
