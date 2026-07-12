import type { IChatProvider } from "../../domain/ports/IChatProvider.js";

/**
 * Envia mensagens via Slack Web API (chat.postMessage).
 *
 * Convenção de threadId: "CHANNEL_ID:thread_ts"
 * O SlackWebhookController monta esse formato e este adapter o decodifica.
 */
export class SlackChatAdapter implements IChatProvider {
    private readonly apiUrl = 'https://slack.com/api/chat.postMessage';

    constructor(private readonly botToken: string) {
        if (!botToken) {
            throw new Error('[SlackChatAdapter] SLACK_BOT_TOKEN não configurado.');
        }
    }

    async sendMessage(threadId: string, content: string): Promise<void> {
        const { channel, thread_ts } = this.decodeThreadId(threadId);

        const body: Record<string, string> = {
            channel,
            text: content,
        };

        // Apenas envia na thread se houver um thread_ts
        if (thread_ts) {
            body.thread_ts = thread_ts;
        }

        try {
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.botToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`[SlackChatAdapter] Erro HTTP ${response.status}: ${errorText}`);
            }

            const result = await response.json() as { ok: boolean; error?: string };
            if (!result.ok) {
                throw new Error(`[SlackChatAdapter] Slack API retornou erro: ${result.error}`);
            }

            console.log(`[SlackChatAdapter] Mensagem enviada com sucesso para channel=${channel}, thread=${thread_ts}`);
        } catch (error) {
            console.error('[SlackChatAdapter] Falha ao enviar mensagem:', error);
            throw error;
        }
    }

    /**
     * Decodifica o threadId no formato "CHANNEL_ID:thread_ts".
     * Se não houver ":", trata o valor inteiro como channel sem thread.
     */
    private decodeThreadId(threadId: string): { channel: string; thread_ts: string } {
        const separatorIndex = threadId.indexOf(':');
        if (separatorIndex === -1) {
            return { channel: threadId, thread_ts: '' };
        }
        return {
            channel: threadId.substring(0, separatorIndex),
            thread_ts: threadId.substring(separatorIndex + 1),
        };
    }
}
