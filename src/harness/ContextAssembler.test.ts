import { describe, it, expect } from 'vitest';
import { ContextAssembler } from './ContextAssembler.js';
import { TiktokenAdapter } from '../infrastructure/tokenizer/TiktokenAdapter.js';
import { ChatContext } from '../domain/ChatContext.js';
import { Message } from '../domain/Message.js';

describe('ContextAssembler', () => {
    const tokenCounter = new TiktokenAdapter();
    const assembler = new ContextAssembler(tokenCounter);

    it('deve montar contexto básico preservando mensagens existentes', async () => {
        const context = new ChatContext('thread-1', 'ws-1');
        context.addMessage(new Message('msg-1', 'user', 'Olá mundo'));

        const assembled = await assembler.assemble(context);
        expect(assembled.messages.length).toBe(1);
        expect(assembled.messages[0].content).toBe('Olá mundo');
    });

    it('deve adicionar instruções de sistema se fornecidas nas opções', async () => {
        const context = new ChatContext('thread-1', 'ws-1');
        context.addMessage(new Message('msg-1', 'user', 'Qual é o status?'));

        const assembled = await assembler.assemble(context, {
            systemInstructions: 'Você é um assistente de suporte.'
        });

        expect(assembled.messages.length).toBe(2);
        expect(assembled.messages[0].role).toBe('system');
        expect(assembled.messages[0].content).toBe('Você é um assistente de suporte.');
    });

    it('deve truncar mensagens antigas respeitando o limite maxTokens', async () => {
        const context = new ChatContext('thread-1', 'ws-1');
        for (let i = 1; i <= 10; i++) {
            context.addMessage(new Message(`msg-${i}`, 'user', `Mensagem número ${i} com texto mais longo para consumir tokens no histórico.`));
        }

        const assembled = await assembler.assemble(context, {
            maxTokens: 50
        });

        // Deve manter as mensagens mais recentes e descartar as mais antigas que excedem o budget
        expect(assembled.messages.length).toBeLessThan(10);
        expect(assembled.messages[assembled.messages.length - 1].content).toContain('10');
    });
});
