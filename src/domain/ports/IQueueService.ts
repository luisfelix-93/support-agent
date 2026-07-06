export interface IQueueService {
    // Envia a mensagem para processamento assíncrono (QStash)
    dispatchMessageProcessing(workspaceId: string, threadId: string, content: string): Promise<void>;
}