import type { MessageRole } from "../Message.js";

export interface IQueueService {
    // Envia a mensagem para processamento assíncrono
    dispatchMessageProcessing(workspaceId: string, threadId: string, content: string, source: 'google' | 'slack'): Promise<void>;
    
    // Envia o contexto recente para extração e promoção de memória em background
    dispatchMemoryPromotion(tenantId: string, workspaceId: string, threadId: string, messages: Array<{ role: MessageRole; content: string }>): Promise<void>;
}