import type { IQueueService } from "../../domain/ports/IQueueService.js";

export class QStashAdapter implements IQueueService {
    constructor(
        private readonly qstashToken: string,
        private readonly workerUrl: string
    ){}

    async dispatchMessageProcessing(workspaceId: string, threadId: string, content: string): Promise<void> {
        const destination = this.workerUrl.trim();
        const qstashUrl = `https://qstash.upstash.io/v2/publish/${destination}`;
        try {
            const response = await fetch(qstashUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.qstashToken.trim()}`,
                    'Content-Type': 'application/json',
                    'Upstash-Retries': '3'
                },
                body: JSON.stringify({
                    workspaceId,
                    threadId,
                    text: content
                })
            });

            if (!response.ok) {
                const errorBody = await response.text().catch(() => 'unable to read body');
                console.error(`[QStash] Resposta de erro: ${response.status} - ${errorBody}`);
                throw new Error(`Falha ao publicar no QStash: Status ${response.status}`);
            }
            const result = await response.json();
            console.log(`[QStash] Mensagem enfileirada com sucesso. MensagemID: ${result.messageId}`);
        } catch (error) {
            console.error('[QStash] Erro ao despachar tarefa para a fila:', error);
            throw error;
        }
    }
}