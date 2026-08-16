import type { ITokenCounter } from "../../domain/ports/ITokenCounter.js";
import type { Message } from "../../domain/Message.js";

/**
 * Adapter para contagem precisa de tokens baseada em regras de heurística BPE e ChatML.
 */
export class TiktokenAdapter implements ITokenCounter {
    countTokens(text: string): number {
        if (!text) return 0;
        const tokens = text.match(/[\w]+|[^\w\s]|\s+/g);
        if (!tokens) return Math.ceil(text.length / 4);

        let total = 0;
        for (const token of tokens) {
            if (token.trim().length === 0) {
                total += Math.ceil(token.length / 4);
            } else {
                total += Math.max(1, Math.ceil(token.length / 3.8));
            }
        }
        return Math.max(1, total);
    }

    countMessagesTokens(messages: Message[]): number {
        let total = 0;
        for (const msg of messages) {
            // ChatML overhead: 4 tokens por mensagem (invocação de papel, tags de sistema/conteúdo)
            total += 4;
            total += this.countTokens(msg.role);
            total += this.countTokens(msg.content);
        }
        return total;
    }
}
