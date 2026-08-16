import type { IContextAssembler, ContextAssemblyOptions } from "../domain/ports/IContextAssembler.js";
import type { ITokenCounter } from "../domain/ports/ITokenCounter.js";
import { ChatContext } from "../domain/ChatContext.js";
import { Message } from "../domain/Message.js";
import crypto from "crypto";

export class ContextAssembler implements IContextAssembler {
    constructor(private readonly tokenCounter: ITokenCounter) {}

    async assemble(
        context: ChatContext,
        options: ContextAssemblyOptions = {}
    ): Promise<ChatContext> {
        const assembledMessages: Message[] = [];
        const maxTokens = options.maxTokens ?? (Number(process.env.MAX_CONTEXT_TOKENS) || 4096);

        // 1. Instuções de sistema se fornecidas
        if (options.systemInstructions) {
            assembledMessages.push(
                new Message(crypto.randomUUID(), 'system', options.systemInstructions)
            );
        }

        // 2. Memórias de longo prazo se fornecidas (Fases futuras)
        if (options.memories && options.memories.length > 0) {
            const memoryText = options.memories
                .map(m => `- [${m.type.toUpperCase()}] ${m.content}`)
                .join('\n');
            assembledMessages.push(
                new Message(
                    crypto.randomUUID(),
                    'system',
                    `Contexto Relevante de Memória:\n${memoryText}`
                )
            );
        }

        // 3. Mensagens existentes do contexto
        const sourceMessages = options.recentMessages && options.recentMessages.length > 0
            ? options.recentMessages
            : context.messages;

        // 4. Token Budgeting: Truncagem de mensagens antigas respeitando o limite maxTokens
        const currentTokens = this.tokenCounter.countMessagesTokens(assembledMessages);
        let availableTokens = maxTokens - currentTokens;

        const selectedFromHistory: Message[] = [];
        // Percorre o histórico do mais recente para o mais antigo
        for (let i = sourceMessages.length - 1; i >= 0; i--) {
            const msg = sourceMessages[i];
            const msgTokens = this.tokenCounter.countMessagesTokens([msg]);

            if (availableTokens - msgTokens >= 0 || selectedFromHistory.length === 0) {
                selectedFromHistory.unshift(msg);
                availableTokens -= msgTokens;
            } else {
                // Se exceder o budget, para de adicionar mensagens mais antigas
                break;
            }
        }

        assembledMessages.push(...selectedFromHistory);

        return new ChatContext(context.threadID, context.workspaceId, assembledMessages);
    }
}
