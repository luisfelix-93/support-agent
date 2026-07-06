import type { IQueueService } from "../../domain/ports/IQueueService.js";

export class QStashAdapter implements IQueueService {
    constructor(
        private readonly qstashToken: string,
        private readonly workerUrl: string
    ){}

    async dispatchMessageProcessing(workspaceId: string, threadId: string, content: string): Promise<void> {
        const qstashUrl = `https://qstash.upstash.io/v1/publish/${this.workerUrl}`;
        try {
            const response = await fetch(qstashUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.qstashToken}`,
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